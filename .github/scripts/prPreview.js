// Comment rendering and reachability for the PR preview workflow, kept apart
// from the YAML so they can be tested without publishing an update. CommonJS on
// purpose, like otaBuildOutcome.js: jest requires it directly.

// Hidden marker the workflow searches for, so a new push edits the existing
// comment instead of stacking one per commit.
const MARKER = '<!-- pr-preview -->';

// eas-cli 22 renamed runtimeVersion → runtime.version; accept both so a payload
// following suit can't read as "no build is compatible".
const runtimeVersionOf = (b) => b.runtimeVersion ?? b.runtime?.version;

// Can any installed PR build receive an update tagged `runtimeVersion`? Updates
// only reach builds with the same fingerprint, so a PR that moves the native
// layer lands on nobody and the app silently keeps showing an older PR.
// 'unknown' (not 'unreachable') when no build reports a runtime version: that is
// an unreadable payload, and claiming a rebuild is needed off it would be a lie.
const reachability = (builds, runtimeVersion) => {
  if (builds.length > 0 && !builds.some(runtimeVersionOf)) return 'unknown';
  const hit = builds.some((b) => b.status === 'FINISHED' && runtimeVersionOf(b) === runtimeVersion);
  return hit ? 'reachable' : 'unreachable';
};

const renderComment = ({ prNumber, sha, runtimeVersion, reachability: reach = 'reachable' }) => {
  const meta = `Commit \`${sha.slice(0, 7)}\` · runtime \`${runtimeVersion}\``;
  const footer =
    '<sub>The app always runs the **most recently published** PR, so with several PRs open the last push wins (re-run the "PR preview" workflow with a PR number to switch back). It uses the staging backend. See CONTRIBUTING → "Previewing a PR on your phone".</sub>';
  const head = {
    reachable: [
      `### 📱 PR #${prNumber} is live in Follow Me (PR)`,
      '',
      'Open the **Follow Me (PR)** app on your phone. It fetches this update on launch, so force-quit and reopen it once if you do not see the change yet — the same way staging picks up merges.',
    ],
    unreachable: [
      `### ⚠️ PR #${prNumber}: Rebuild needed — this will NOT show in Follow Me (PR)`,
      '',
      'This PR changes native code or dependencies, so no installed **Follow Me (PR)** build can load its update. The app keeps showing an older PR. To see this one, build and install a new copy:',
      '',
      '```bash',
      'eas build --profile pr-preview --platform ios',
      '```',
      '',
      'Run it from this PR\'s branch, then re-run the "PR preview" workflow with this PR\'s number.',
    ],
    unknown: [
      `### 📱 PR #${prNumber} published, but I could not check whether the app can load it`,
      '',
      'The update is published, but I could not check it against the installed builds (unreadable `eas build:list` output). If you do not see the change after reopening **Follow Me (PR)**, this PR probably needs a rebuild: `eas build --profile pr-preview --platform ios`.',
    ],
  }[reach];
  return [MARKER, ...head, '', meta, '', footer].join('\n');
};

module.exports = { MARKER, reachability, renderComment };
