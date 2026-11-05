// Comment rendering for the PR preview workflow, kept apart from the YAML so it
// can be tested without publishing an update. CommonJS on purpose, like
// otaBuildOutcome.js: jest requires it directly.

// Hidden marker the workflow searches for, so a new push edits the existing
// comment instead of stacking one per commit.
const MARKER = '<!-- pr-preview -->';

const renderComment = ({ prNumber, sha, runtimeVersion }) =>
  [
    MARKER,
    `### 📱 PR #${prNumber} is live in Follow Me (PR)`,
    '',
    'Open the **Follow Me (PR)** app on your phone. It fetches this update on launch, so force-quit and reopen it once if you do not see the change yet — the same way staging picks up merges.',
    '',
    `Commit \`${sha.slice(0, 7)}\` · runtime \`${runtimeVersion}\``,
    '',
    '<sub>The app always runs the **most recently published** PR, so with several PRs open the last push wins (re-run the "PR preview" workflow with a PR number to switch back). It uses the staging backend. If this PR changes native code or dependencies, the installed build will not accept it and needs a rebuild — see CONTRIBUTING → "Previewing a PR on your phone".</sub>',
  ].join('\n');

module.exports = { MARKER, renderComment };
