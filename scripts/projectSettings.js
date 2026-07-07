/**
 * Resolves the developer-specific values the extension scripts need.
 * Order: environment variables (MAIN_BUNDLE_ID, DEV_TEAM) → the main app
 * target's own build settings in project.pbxproj. Fails fast when neither
 * source provides a value, so the scripts never write someone else's team
 * or bundle id into the project.
 */
function deriveNativeSettings(project, mainTargetName = 'FollowMe') {
  const fromProject = { bundleId: null, devTeam: null };

  const objects = project.hash.project.objects;
  const targetEntry = Object.entries(objects['PBXNativeTarget'] ?? {}).find(
    ([key, target]) => !key.endsWith('_comment') && target.name?.replace(/"/g, '') === mainTargetName,
  );
  if (targetEntry) {
    const configListId = targetEntry[1].buildConfigurationList;
    const configList = objects['XCConfigurationList']?.[configListId];
    for (const ref of configList?.buildConfigurations ?? []) {
      const settings = objects['XCBuildConfiguration']?.[ref.value]?.buildSettings ?? {};
      const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER?.replace(/"/g, '');
      const devTeam = settings.DEVELOPMENT_TEAM?.replace(/"/g, '');
      if (bundleId && !fromProject.bundleId) fromProject.bundleId = bundleId;
      if (devTeam && !fromProject.devTeam) fromProject.devTeam = devTeam;
    }
  }

  const bundleId = process.env.MAIN_BUNDLE_ID || fromProject.bundleId;
  const devTeam = process.env.DEV_TEAM || fromProject.devTeam;

  const missing = [];
  if (!bundleId) missing.push('MAIN_BUNDLE_ID');
  if (!devTeam) missing.push('DEV_TEAM');
  if (missing.length > 0) {
    console.error(
      `❌  Could not determine ${missing.join(' and ')} — not found in the ${mainTargetName} ` +
      'target\'s build settings. Set the environment variable(s), e.g.:\n' +
      '    MAIN_BUNDLE_ID=com.you.yourapp DEV_TEAM=ABCDE12345 npm run setup:ios-extensions',
    );
    process.exit(1);
  }

  return { bundleId, devTeam };
}

module.exports = { deriveNativeSettings };
