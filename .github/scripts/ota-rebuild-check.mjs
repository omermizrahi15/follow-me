// Answers one question authoritatively: can this OTA update actually reach an
// installed build?
//
// runtimeVersion policy is `fingerprint` (app.config.js), so every update is
// tagged with a hash of the native layer — config, plugins, native modules. An
// update is only delivered to builds carrying the SAME hash. Change anything
// native and `eas update` still succeeds, but the update lands on zero devices
// and nothing says so. This asks EAS whether a finished build with that exact
// runtimeVersion exists, and if not, explains which native input moved and
// (optionally) starts the rebuild.
//
// Env:
//   CHANNEL           staging | production          (required)
//   PROFILE           eas.json build profile        (required)
//   RUNTIME_VERSION   hash of the published update  (optional — else computed
//                     from the checkout, which is the pre-merge "will this need
//                     a rebuild?" question)
//   AUTO_BUILD        '1' to start `eas build` when nothing can receive it
//   MODE              'cd' (exit 1 when unreachable) | 'preflight' (never fails)

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import QRCode from 'qrcode';

const CHANNEL = process.env.CHANNEL;
const PROFILE = process.env.PROFILE;
const MODE = process.env.MODE === 'preflight' ? 'preflight' : 'cd';
const AUTO_BUILD = process.env.AUTO_BUILD === '1';

if (!CHANNEL || !PROFILE) {
  console.error('CHANNEL and PROFILE are required');
  process.exit(1);
}

// `eas --json` keeps stdout pure JSON and sends progress to stderr, so the
// output can be parsed directly. maxBuffer is raised because a fingerprint
// carries the full contents of every source it hashed.
const eas = (args) =>
  JSON.parse(execSync(`eas ${args} --json --non-interactive`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

// Builds that could still become compatible — no point starting a second one.
const PENDING = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS']);

// --build-profile is what makes this hash match EAS: it loads the profile's env
// (eas.json + the server-side env vars), so APP_VARIANT and SENTRY_ORG are set
// and app.config.js resolves to the same config the build was made from. Without
// it the fingerprint is real but belongs to a different variant. Computed
// lazily — the reachable path never needs it.
let localFingerprint;
const local = () =>
  (localFingerprint ??= eas(`fingerprint:generate --platform ios --build-profile ${PROFILE}`));

// --- 1. the runtimeVersion this update is (or would be) tagged with ---
const runtimeVersion = process.env.RUNTIME_VERSION || local().hash;

// --- 2. every build on this channel, newest first ---
const builds = eas(`build:list --platform ios --channel ${CHANNEL} --limit 50`);
const compatible = builds.filter((b) => b.runtimeVersion === runtimeVersion);
const reachable = compatible.filter((b) => b.status === 'FINISHED');
const pending = compatible.filter((b) => PENDING.has(b.status));

// --- 3. when unreachable: which native input moved? ---
// Compare against the newest finished build on the channel — the binary most
// likely sitting on the device. Both fingerprints list their sources, so the
// ones whose hash differs name the cause.
const PRETTY = [
  [/^node_modules\/(.+)$/, (m) => `native module \`${m[1]}\``],
  [/^expoConfig$/, () => 'app config (`app.json` / `app.config.js`)'],
  [/^packageJson:(.+)$/, (m) => `\`package.json\` → \`${m[1]}\``],
  [/^rncoreAutolinkingConfig:(.+)$/, (m) => `autolinked native modules (${m[1]})`],
];
const pretty = (id) => {
  for (const [re, fmt] of PRETTY) {
    const m = re.exec(id);
    if (m) return fmt(m);
  }
  return `\`${id}\``;
};

const explainAgainst = (build) => {
  // fingerprint1 is the build's own fingerprint, fetched from EAS. fingerprint2
  // is ignored: `compare` recomputes the local side without the build profile's
  // env, which reports config differences that aren't real. local() is the same
  // hash EAS computed, so it's the honest other half of the diff.
  const cmp = eas(`fingerprint:compare --build-id ${build.id}`);
  const key = (s) => s.id ?? s.filePath ?? JSON.stringify(s).slice(0, 60);
  const index = (f) => new Map((f.sources ?? []).map((s) => [key(s), s.hash]));
  const before = index(cmp.fingerprint1);
  const after = index(local());
  const changes = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(id) === after.get(id)) continue;
    changes.push({ id, kind: !before.has(id) ? 'added' : !after.has(id) ? 'removed' : 'changed' });
  }
  return changes.sort((a, b) => a.id.localeCompare(b.id));
};

// A freshly started build carries no project in its payload, so fall back to the
// one every listed build reports — it's the same project either way.
const PROJECT = builds.find((b) => b.project)?.project;
const buildUrl = (b) => {
  const p = b.project ?? PROJECT;
  return p && `https://expo.dev/accounts/${p.ownerAccount?.name}/projects/${p.slug}/builds/${b.id}`;
};

// A scannable QR of the build page, so the phone that has to install the .ipa
// never has to receive the URL by hand.
//
// The symbol can't live in the job summary itself. Drawn with characters it is
// unreadable — GitHub's code blocks leave a background gap between glyph rows
// (a 12px glyph in an 18px line box), and rastered at that geometry no decoder
// resolves it — and GitHub's sanitizer strips the src off `data:` images, so it
// can't be inlined as one either. So the summary links docs/install/, a static
// page on the repo's existing GitHub Pages site, and hands it the finished
// symbol in the fragment: `#<size>.<base64url bits>.<encoded url>`, row-major,
// one bit per module. Encoding it here keeps that page free of any QR library,
// and a fragment is never sent to a server.
const INSTALL_PAGE = (() => {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'omermizrahi15/follow-me').split('/');
  return `https://${owner}.github.io/${repo}/install/`;
})();

const scanLink = (url) => {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'L' });
  const { size, data } = modules;
  const bytes = Buffer.alloc(Math.ceil((size * size) / 8));
  for (let i = 0; i < size * size; i++) if (data[i]) bytes[i >> 3] |= 128 >> (i & 7);
  return `${INSTALL_PAGE}#${size}.${bytes.toString('base64url')}.${encodeURIComponent(url)}`;
};

// --- 4. render ---
const out = [];
const push = (...lines) => out.push(...lines);

if (reachable.length) {
  push(`## ✅ OTA reachable — no rebuild needed`, '');
  push(`\`${CHANNEL}\` has an installed build on runtimeVersion \`${runtimeVersion}\`, so this update is delivered over-the-air. Nothing to do on your machine.`, '');
  const b = reachable[0];
  push(`Matching build: [\`${b.id.slice(0, 8)}\`](${buildUrl(b)}) · ${(b.gitCommitHash ?? '').slice(0, 7)} · ${b.completedAt ?? b.createdAt}`, '');
} else {
  push(`## ⚠️ Native rebuild required — this update reaches no device`, '');
  push(
    MODE === 'preflight'
      ? `Once merged, the OTA for \`${CHANNEL}\` will be tagged runtimeVersion \`${runtimeVersion}\`, and **no installed build carries that runtimeVersion**. The update would publish successfully and be delivered to nobody.`
      : `The update just published to \`${CHANNEL}\` is tagged runtimeVersion \`${runtimeVersion}\`, and **no finished build carries that runtimeVersion**. It is live on EAS but no installed app can receive it — the fingerprint policy correctly refuses to hand native-incompatible JS to an old binary.`,
    ''
  );

  const latest = builds.find((b) => b.status === 'FINISHED');
  if (latest) {
    push(`The newest installed \`${CHANNEL}\` build is on \`${latest.runtimeVersion}\`. What moved:`, '');
    try {
      const changes = explainAgainst(latest);
      if (changes.length) {
        for (const c of changes) push(`- **${c.kind}** — ${pretty(c.id)}`);
      } else {
        push('- _(none — this checkout fingerprints identically to that build, so the runtimeVersion above came from a different commit)_');
      }
      if (process.env.RUNTIME_VERSION && local().hash !== process.env.RUNTIME_VERSION) {
        push('', `> Note: this checkout fingerprints to \`${local().hash}\`, not the published \`${runtimeVersion}\` — the diff above is for the checkout, not the update.`);
      }
    } catch (err) {
      push(`- _(could not diff fingerprints: ${err.message.split('\n')[0]})_`);
    }
    push('');
  }

  // --- 5. start the rebuild ---
  if (pending.length) {
    const b = pending[0];
    push(`### 🏗 A matching build is already running`, '');
    push(`[Build \`${b.id.slice(0, 8)}\`](${buildUrl(b)}) (${b.status}) is on this runtimeVersion — no new build started. Install it when it finishes and the OTA lands.`, '');
    push(`### [📱 Scan to install on your phone →](${scanLink(buildUrl(b))})`, '');
  } else if (AUTO_BUILD && MODE === 'cd') {
    push(`### 🏗 Rebuild started automatically`, '');
    try {
      const started = eas(`build --platform ios --profile ${PROFILE} --message "auto: runtimeVersion ${runtimeVersion.slice(0, 12)} has no installed build"`);
      const b = Array.isArray(started) ? started[0] : started;
      const url = buildUrl(b);
      push(`[Build \`${b.id.slice(0, 8)}\`](${url}) is queued on profile \`${PROFILE}\`.`, '');
      push(`**You still have to install it** — internal distribution can't push a binary to your phone.`, '');
      push(`### [📱 Scan to install on your phone →](${scanLink(url)})`, '');
      push(`Opens a QR for this build. Point your camera at it, then tap **Install** once the build goes green.`, '');
    } catch (err) {
      push(`Could not start the build automatically — run it yourself:`, '');
      push('```bash', `eas build --profile ${PROFILE} --platform ios`, '```', '');
      push(`<details><summary>error</summary>\n\n\`\`\`\n${err.message}\n\`\`\`\n\n</details>`, '');
    }
  } else {
    push(`### Rebuild and reinstall`, '');
    push('```bash', `eas build --profile ${PROFILE} --platform ios`, '```', '');
  }
}

const report = out.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');

if (!reachable.length && process.env.GITHUB_ACTIONS) {
  const msg = `runtimeVersion ${runtimeVersion} has no installed ${CHANNEL} build — this OTA reaches no device until you rebuild and reinstall.`;
  console.log(MODE === 'cd' ? `::error title=Native rebuild required::${msg}` : `::warning title=Native rebuild will be required::${msg}`);
}

// Red on main is the signal: the merge is not actually on your phone yet. In
// preflight (PR) mode this is advisory only and never blocks the merge.
process.exit(!reachable.length && MODE === 'cd' ? 1 : 0);
