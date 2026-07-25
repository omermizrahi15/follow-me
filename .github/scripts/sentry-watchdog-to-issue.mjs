// Opens a GitHub bug issue for every critical "watchdog"-family Sentry issue
// (Watchdog Termination, App Hang, Out-of-Memory) that isn't already tracked.
//
// Driven by .github/workflows/sentry-watchdog-to-issue.yml on a 15-minute cron.
// It is intentionally stateless: dedup is done by searching existing GitHub
// issues for a hidden `sentry-issue-id:<id>` marker in their body, so re-runs
// (and backfilling old issues on first run) never create duplicates.
//
// Config comes entirely from env (all already present in the repo):
//   SENTRY_ORG          repo variable  (follow-me-m3)
//   SENTRY_PROJECT      repo variable  (react-native)
//   SENTRY_ISSUES_TOKEN repo secret    (Sentry token with `event:read` +
//                       `project:read`; falls back to SENTRY_AUTH_TOKEN). The
//                       existing SENTRY_AUTH_TOKEN is a release/source-map-upload
//                       token and does NOT have event:read — so reading issues
//                       needs a dedicated read token stored here.
//   GITHUB_TOKEN        workflow token (needs issues: write)
//   GITHUB_REPOSITORY   owner/repo, provided by Actions
// Optional overrides:
//   SENTRY_QUERY        Sentry search (default: is:unresolved level:fatal)
//   MATCH_REGEX         which fatal issues count as "watchdog" (see default)
//   STATS_PERIOD        Sentry lookback window (default: 14d)
//   MAX_ISSUES_PER_RUN  safety cap on new issues per run (default: 10)
//   DRY_RUN             "true" => log what it would do, create nothing

const SENTRY_BASE = 'https://sentry.io/api/0';
const GH_BASE = 'https://api.github.com';

const {
  SENTRY_ORG,
  SENTRY_PROJECT,
  SENTRY_ISSUES_TOKEN,
  SENTRY_AUTH_TOKEN,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  SENTRY_QUERY = 'is:unresolved level:fatal',
  // Matched (case-insensitive) against each issue's title, culprit, and
  // metadata. Defaults to the watchdog family: iOS watchdog terminations, app
  // hangs, and out-of-memory kills — the crashes that don't produce a normal
  // stack trace and are easy to miss.
  MATCH_REGEX = 'watchdog|app ?hang|out of memory|\\boom\\b',
  STATS_PERIOD = '14d',
  MAX_ISSUES_PER_RUN = '10',
  DRY_RUN = 'false',
} = process.env;

const dryRun = DRY_RUN === 'true';
const maxIssues = Number.parseInt(MAX_ISSUES_PER_RUN, 10) || 10;
const matcher = new RegExp(MATCH_REGEX, 'i');

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
}
const sentryToken = SENTRY_ISSUES_TOKEN || SENTRY_AUTH_TOKEN;
requireEnv('SENTRY_ORG', SENTRY_ORG);
requireEnv('SENTRY_PROJECT', SENTRY_PROJECT);
requireEnv('SENTRY_ISSUES_TOKEN (or SENTRY_AUTH_TOKEN)', sentryToken);
requireEnv('GITHUB_TOKEN', GITHUB_TOKEN);
requireEnv('GITHUB_REPOSITORY', GITHUB_REPOSITORY);

const [owner, repo] = GITHUB_REPOSITORY.split('/');

async function sentry(path, params = {}) {
  const url = new URL(`${SENTRY_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${sentryToken}` },
  });
  if (!res.ok) {
    throw new Error(`Sentry ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function github(method, path, body) {
  const res = await fetch(`${GH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// A watchdog issue is "the same" across runs iff it has the same Sentry issue
// id. We stash that id in a hidden marker in the issue body and search for it.
function marker(issueId) {
  return `sentry-issue-id:${issueId}`;
}

async function alreadyTracked(issueId) {
  const q = `repo:${owner}/${repo} in:body "${marker(issueId)}"`;
  const res = await github('GET', `/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
  return res.total_count > 0;
}

// GitHub labels must exist before use; create `sentry` idempotently.
async function ensureLabel(name, color, description) {
  try {
    await github('POST', `/repos/${owner}/${repo}/labels`, { name, color, description });
    console.log(`Created label: ${name}`);
  } catch (err) {
    if (!String(err).includes('-> 422')) throw err; // 422 = already exists
  }
}

function isWatchdog(issue) {
  const haystack = [
    issue.title,
    issue.culprit,
    issue.metadata?.type,
    issue.metadata?.value,
    issue.metadata?.function,
  ]
    .filter(Boolean)
    .join(' ');
  return matcher.test(haystack);
}

function issueBody(issue) {
  const affected = issue.count ?? '—';
  const users = issue.userCount ?? '—';
  return [
    `**Auto-filed from Sentry** — a critical watchdog-family crash.`,
    '',
    `- **Issue:** [${issue.shortId}](${issue.permalink})`,
    `- **Culprit:** \`${issue.culprit || 'n/a'}\``,
    `- **Level:** ${issue.level ?? 'fatal'}`,
    `- **Events:** ${affected}  ·  **Users affected:** ${users}`,
    `- **First seen:** ${issue.firstSeen}`,
    `- **Last seen:** ${issue.lastSeen}`,
    '',
    '---',
    '_Filed automatically by `.github/workflows/sentry-watchdog-to-issue.yml`._',
    '',
    `<!-- ${marker(issue.id)} -->`,
  ].join('\n');
}

async function main() {
  console.log(
    `Scanning Sentry ${SENTRY_ORG}/${SENTRY_PROJECT} · query="${SENTRY_QUERY}" · ` +
      `match=/${MATCH_REGEX}/i · period=${STATS_PERIOD}${dryRun ? ' · DRY RUN' : ''}`,
  );

  const issues = await sentry(`/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/`, {
    query: SENTRY_QUERY,
    statsPeriod: STATS_PERIOD,
    limit: '100',
  });

  const watchdog = issues.filter(isWatchdog);
  console.log(`${issues.length} fatal issue(s) fetched, ${watchdog.length} match watchdog filter.`);

  if (watchdog.length && !dryRun) {
    await ensureLabel('sentry', 'b4a7d6', 'Auto-filed from a Sentry alert');
  }

  let created = 0;
  for (const issue of watchdog) {
    if (created >= maxIssues) {
      console.log(`Hit MAX_ISSUES_PER_RUN=${maxIssues}; stopping. Remaining will be filed next run.`);
      break;
    }
    if (await alreadyTracked(issue.id)) {
      console.log(`skip ${issue.shortId} — already tracked`);
      continue;
    }
    const title = `🚨 [Sentry] ${issue.title}`.slice(0, 250);
    if (dryRun) {
      console.log(`would create: ${title}  (${issue.permalink})`);
      created += 1;
      continue;
    }
    const gh = await github('POST', `/repos/${owner}/${repo}/issues`, {
      title,
      body: issueBody(issue),
      labels: ['bug', 'sentry'],
    });
    console.log(`created #${gh.number}: ${title}`);
    created += 1;
  }

  console.log(`Done. ${dryRun ? 'Would create' : 'Created'} ${created} issue(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
