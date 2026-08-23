// Mirrors unresolved Sentry issues into GitHub bug issues:
//   - an issue that isn't tracked yet gets a new GitHub issue;
//   - one that is already tracked gets its body refreshed with the current
//     counts, and is reopened with a comment if it fired again after the
//     GitHub issue was closed.
//
// Scope is every unresolved `error` and `fatal` issue — not just crashes. The
// app reports its own failures through `reportError` (src/infrastructure/
// monitoring/sentry.ts), which Sentry records at level `error`; an earlier
// `level:fatal` filter here meant none of them could ever be filed, and only
// native watchdog/OOM terminations came through. `warning` (what
// `reportMessage` emits) and `info` stay out on purpose — those are expected
// conditions we watch, not things to open a bug for.
//
// Driven by .github/workflows/sentry-to-issue.yml on a 15-minute cron.
// It is intentionally stateless: dedup is done by a hidden
// `sentry-issue-id:<id>` marker in the GitHub issue body, so re-runs (and
// backfilling old issues on first run) never create duplicates — and the issue
// itself is where the "what did we last see?" state lives.
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
//   SENTRY_QUERY        Sentry search (default: is:unresolved)
//   LEVELS              comma-separated levels to file (default: error,fatal).
//                       Filtered client-side rather than in SENTRY_QUERY so a
//                       multi-level selection doesn't depend on Sentry search
//                       syntax.
//   MATCH_REGEX         optional extra title/culprit filter (default: none)
//   STATS_PERIOD        Sentry lookback window (default: 14d)
//   MAX_ISSUES_PER_RUN  safety cap on new issues per run (default: 10). A
//                       backlog is filed 10 at a time across successive runs.
//   DRY_RUN             "true" => log what it would do, create nothing

const SENTRY_BASE = 'https://sentry.io/api/0';
const GH_BASE = 'https://api.github.com';
const TRACKING_LABEL = 'sentry';

const {
  SENTRY_ORG,
  SENTRY_PROJECT,
  SENTRY_ISSUES_TOKEN,
  SENTRY_AUTH_TOKEN,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  SENTRY_QUERY = 'is:unresolved',
  LEVELS = 'error,fatal',
  // Optional narrowing on top of the level filter, matched (case-insensitive)
  // against each issue's title, culprit, and metadata. Empty means "file every
  // issue at a matching level".
  MATCH_REGEX = '',
  STATS_PERIOD = '14d',
  MAX_ISSUES_PER_RUN = '10',
  DRY_RUN = 'false',
} = process.env;

const dryRun = DRY_RUN === 'true';
const maxIssues = Number.parseInt(MAX_ISSUES_PER_RUN, 10) || 10;
const matcher = MATCH_REGEX ? new RegExp(MATCH_REGEX, 'i') : null;
const levels = new Set(
  LEVELS.split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);

// Fatal is a crash; error is something the app caught and reported. The title
// prefix carries that distinction so the issue list is scannable at a glance.
const LEVEL_EMOJI = { fatal: '🚨', error: '🐞', warning: '⚠️' };

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

// A Sentry issue is "the same" across runs iff it has the same Sentry issue id.
// We stash that id in a hidden marker in the GitHub issue body.
function marker(issueId) {
  return `sentry-issue-id:${issueId}`;
}
const MARKER_RE = /sentry-issue-id:(\d+)/;

/**
 * Every GitHub issue this workflow has ever filed, keyed by Sentry issue id.
 *
 * Built from one paginated listing of the `sentry` label rather than a
 * per-issue code search. With the old `level:fatal` scope there were at most a
 * couple of matches per run, so a search call each was fine; filing every error
 * makes that dozens of calls against the 30/min search rate limit — and the
 * search index lags behind issue creation, which is exactly how a dedup check
 * files a duplicate.
 */
async function loadTracked() {
  const bySentryId = new Map();
  for (let page = 1; ; page += 1) {
    let batch;
    try {
      batch = await github(
        'GET',
        `/repos/${owner}/${repo}/issues?labels=${TRACKING_LABEL}&state=all&per_page=100&page=${page}`,
      );
    } catch (err) {
      // Label doesn't exist yet => nothing has ever been filed.
      if (String(err).includes('-> 404')) break;
      throw err;
    }
    for (const gh of batch) {
      if (gh.pull_request) continue;
      const id = MARKER_RE.exec(gh.body ?? '')?.[1];
      if (id) bySentryId.set(id, gh);
    }
    if (batch.length < 100) break;
  }
  return bySentryId;
}

/**
 * Fallback for an issue whose `sentry` label a human removed: the label listing
 * misses it, but the marker is still in its body. Only runs for ids that look
 * new, so the search-rate-limit cost stays proportional to genuinely new issues.
 */
async function searchTracked(issueId) {
  const q = `repo:${owner}/${repo} in:body "${marker(issueId)}"`;
  const res = await github('GET', `/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
  return res.items?.[0] ?? null;
}

// GitHub labels must exist before use; create them idempotently.
async function ensureLabel(name, color, description) {
  try {
    await github('POST', `/repos/${owner}/${repo}/labels`, { name, color, description });
    console.log(`Created label: ${name}`);
  } catch (err) {
    if (!String(err).includes('-> 422')) throw err; // 422 = already exists
  }
}

function matchesFilter(issue) {
  if (!levels.has(String(issue.level ?? '').toLowerCase())) return false;
  if (matcher == null) return true;
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
  const level = issue.level ?? 'error';
  return [
    `**Auto-filed from Sentry** — an unresolved \`${level}\`-level issue.`,
    '',
    `- **Issue:** [${issue.shortId}](${issue.permalink})`,
    `- **Culprit:** \`${issue.culprit || 'n/a'}\``,
    `- **Level:** ${level}`,
    `- **Events:** ${affected}  ·  **Users affected:** ${users}`,
    `- **First seen:** ${issue.firstSeen}`,
    `- **Last seen:** ${issue.lastSeen}`,
    '',
    '---',
    '_Filed — and these counts kept up to date — by `.github/workflows/sentry-to-issue.yml`._',
    '',
    `<!-- ${marker(issue.id)} -->`,
  ].join('\n');
}

/**
 * Keeps an already-filed issue honest.
 *
 * The body is a snapshot written at filing time, so a tracked issue used to go
 * stale the moment it was created — you could not tell from GitHub whether the
 * error was still happening. Two things happen here:
 *
 *  - the body is rewritten with the current event/user counts and last-seen, so
 *    the issue always shows live numbers. Editing a body notifies nobody, which
 *    is what we want for something that fires every few minutes.
 *  - a *closed* issue that has fired again since it was closed is reopened with
 *    a comment. That is the loud signal, and it is rare enough to be trusted.
 */
async function refreshTracked(sentryIssue, ghIssue) {
  const body = issueBody(sentryIssue);
  const closedAt = ghIssue.closed_at ? new Date(ghIssue.closed_at) : null;
  const lastSeen = sentryIssue.lastSeen ? new Date(sentryIssue.lastSeen) : null;
  const regressed =
    ghIssue.state === 'closed' && closedAt != null && lastSeen != null && lastSeen > closedAt;
  const staleBody = ghIssue.body !== body;

  // Always log the live numbers, even when nothing changes: a dry run is the
  // only way to ask "is this still firing?" without a Sentry login.
  const stats =
    `#${ghIssue.number} ${sentryIssue.shortId} [${ghIssue.state}] — ` +
    `${sentryIssue.count ?? '—'} events, ${sentryIssue.userCount ?? '—'} user(s), ` +
    `last seen ${sentryIssue.lastSeen ?? 'never'}`;

  if (dryRun) {
    const verb = regressed ? 'would REOPEN + comment' : staleBody ? 'would refresh' : 'unchanged';
    console.log(`${verb}  ${stats}`);
    // Tracked issues get the diagnostic dump too — the latest event's release
    // tag is how you tell an old binary still failing from a real regression.
    await dumpDetails(sentryIssue);
    return;
  }

  if (!regressed && !staleBody) {
    console.log(`unchanged  ${stats}`);
    return;
  }

  await github('PATCH', `/repos/${owner}/${repo}/issues/${ghIssue.number}`, {
    body,
    ...(regressed ? { state: 'open' } : {}),
  });

  if (regressed) {
    await github('POST', `/repos/${owner}/${repo}/issues/${ghIssue.number}/comments`, {
      body: [
        `🔁 **This came back.** Reopening.`,
        '',
        `It was last seen at **${sentryIssue.lastSeen}**, after this issue was closed on ${ghIssue.closed_at}.`,
        `Sentry is now up to **${sentryIssue.count ?? '—'} events** across **${sentryIssue.userCount ?? '—'} user(s)**.`,
        '',
        `[Open in Sentry](${sentryIssue.permalink})`,
      ].join('\n'),
    });
    console.log(`REOPENED   ${stats}`);
  } else {
    console.log(`refreshed  ${stats}`);
  }
}

// Diagnostic dump (dry-run only): pulls the latest event for a matched issue and
// prints exception + top stack frames + key tags, so a maintainer can triage
// straight from the workflow log without opening Sentry.
async function dumpDetails(issue) {
  try {
    const event = await sentry(`/issues/${issue.id}/events/latest/`);
    const exc = (event.entries || []).find((e) => e.type === 'exception');
    const values = exc?.data?.values || [];
    const tags = Object.fromEntries((event.tags || []).map((t) => [t.key, t.value]));
    console.log(`\n──── ${issue.shortId}: ${issue.title} ────`);
    console.log(`link:    ${issue.permalink}`);
    console.log(`culprit: ${issue.culprit || 'n/a'}`);
    console.log(
      `tags:    operation=${tags.operation || '?'} mechanism=${tags.mechanism || '?'} ` +
        `os=${tags['os'] || tags['os.name'] || '?'} ` +
        `device=${tags['device'] || tags['device.family'] || '?'} release=${tags.release || '?'}`,
    );
    for (const v of values) {
      console.log(`\n  ${v.type}: ${v.value || ''}  [mechanism: ${v.mechanism?.type || 'n/a'}]`);
      const frames = (v.stacktrace?.frames || []).slice(-8).reverse();
      for (const f of frames) {
        const loc = [f.filename || f.module, f.lineNo].filter(Boolean).join(':');
        console.log(`    at ${f.function || '?'} (${loc})${f.inApp ? '  [in-app]' : ''}`);
      }
    }
    console.log('────────────────────────────────────────\n');
  } catch (err) {
    console.log(`  (could not fetch event details: ${err})`);
  }
}

async function main() {
  console.log(
    `Scanning Sentry ${SENTRY_ORG}/${SENTRY_PROJECT} · query="${SENTRY_QUERY}" · ` +
      `levels=${[...levels].join(',')}${matcher ? ` · match=/${MATCH_REGEX}/i` : ''} · ` +
      `period=${STATS_PERIOD}${dryRun ? ' · DRY RUN' : ''}`,
  );

  const issues = await sentry(`/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/`, {
    query: SENTRY_QUERY,
    statsPeriod: STATS_PERIOD,
    limit: '100',
  });

  const matched = issues.filter(matchesFilter);
  console.log(`${issues.length} unresolved issue(s) fetched, ${matched.length} match the filter.`);
  if (!matched.length) {
    console.log('Done. Nothing to file.');
    return;
  }

  if (!dryRun) {
    await ensureLabel(TRACKING_LABEL, 'b4a7d6', 'Auto-filed from a Sentry alert');
  }
  const tracked = await loadTracked();
  console.log(`${tracked.size} Sentry issue(s) already tracked in GitHub.`);

  // Newest first, so when the cap bites it's the freshest breakage that gets
  // filed rather than whatever Sentry happened to return first.
  matched.sort((a, b) => String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')));

  let created = 0;
  let refreshed = 0;
  let deferred = 0;
  for (const issue of matched) {
    const existing = tracked.get(String(issue.id)) ?? (await searchTracked(issue.id));
    if (existing != null) {
      // Refreshing an existing issue is cheap and never spams, so it is not
      // subject to MAX_ISSUES_PER_RUN — that cap guards issue *creation*.
      await refreshTracked(issue, existing);
      refreshed += 1;
      continue;
    }
    if (created >= maxIssues) {
      deferred += 1;
      continue;
    }
    const emoji = LEVEL_EMOJI[String(issue.level ?? '').toLowerCase()] ?? '⚠️';
    const title = `${emoji} [Sentry] ${issue.title}`.slice(0, 250);
    if (dryRun) {
      console.log(`would create: ${title}  (${issue.permalink})`);
      await dumpDetails(issue);
      created += 1;
      continue;
    }
    const gh = await github('POST', `/repos/${owner}/${repo}/issues`, {
      title,
      body: issueBody(issue),
      labels: ['bug', TRACKING_LABEL],
    });
    console.log(`created #${gh.number}: ${title}`);
    created += 1;
  }

  // Say out loud what the cap swallowed — a silent truncation reads as "nothing
  // else is broken", which is the opposite of the truth.
  if (deferred) {
    console.log(
      `MAX_ISSUES_PER_RUN=${maxIssues} reached — ${deferred} new issue(s) NOT filed this run; ` +
        `the next run picks them up.`,
    );
  }
  console.log(
    `Done. ${dryRun ? 'Would create' : 'Created'} ${created} issue(s), ` +
      `${refreshed} already tracked, ${deferred} deferred.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
