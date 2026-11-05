// Link + comment rendering for the PR preview workflow, kept apart from the YAML
// so the shapes can be tested without publishing an update. CommonJS on purpose,
// like otaBuildOutcome.js: jest requires it directly.

// Hidden marker the workflow searches for, so a new push edits the existing
// comment instead of stacking one per commit.
const MARKER = '<!-- pr-preview -->';

const previewLinks = ({ projectId, groupId, slug = 'follow-me' }) => {
  const updateUrl = `https://u.expo.dev/${projectId}/group/${groupId}`;
  // `exp+<slug>://expo-development-client/?url=…` is the scheme a development
  // build registers; it fetches that update group and runs it in place.
  const deepLink = `exp+${slug}://expo-development-client/?url=${encodeURIComponent(updateUrl)}`;
  return {
    deepLink,
    dashboardUrl: `https://expo.dev/projects/${projectId}/updates/${groupId}`,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(deepLink)}`,
  };
};

const renderComment = ({ prNumber, sha, links, runtimeVersion }) =>
  [
    MARKER,
    `### 📱 Preview PR #${prNumber} on your phone`,
    '',
    `![QR](${links.qrUrl})`,
    '',
    `Scan with the Camera app, or [tap to open](${links.deepLink}) from your phone.`,
    '',
    `Commit \`${sha.slice(0, 7)}\` · runtime \`${runtimeVersion}\` · [update on Expo](${links.dashboardUrl})`,
    '',
    '<sub>Needs the **Follow Me (PR)** build installed once (see CONTRIBUTING → "Previewing a PR on your phone"). It talks to the staging backend.</sub>',
  ].join('\n');

module.exports = { MARKER, previewLinks, renderComment };
