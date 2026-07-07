/**
 * Embeds the app-extension targets (NSE + content extension) into the main app:
 * - adds an "Embed App Extensions" copy-files phase to the FollowMe target
 * - adds target dependencies so extensions build before the app
 * Without this the .appex bundles are built but never packaged, so the
 * extensions silently never run. Idempotent — safe to re-run.
 * Run: node scripts/embed-extensions.js
 */
const xcode = require('../node_modules/xcode');
const fs = require('fs');
const path = require('path');

const PROJ_PATH = path.join(__dirname, '../ios/FollowMe.xcodeproj/project.pbxproj');
const MAIN_TARGET = 'FollowMe';
const EXTENSIONS = ['NotificationServiceExtension', 'NotificationContentExtension'];

const project = xcode.project(PROJ_PATH);
project.parseSync();

const objects = project.hash.project.objects;
const uuid = () => project.generateUuid();

// --- Locate the main app target ---
const mainTargetEntry = Object.entries(objects['PBXNativeTarget']).find(
  ([k, t]) => !k.endsWith('_comment') && t.name?.replace(/"/g, '') === MAIN_TARGET,
);
if (!mainTargetEntry) throw new Error(`Main target ${MAIN_TARGET} not found`);
const [mainTargetUuid, mainTarget] = mainTargetEntry;

// --- Find or create the "Embed App Extensions" copy-files phase ---
objects['PBXCopyFilesBuildPhase'] = objects['PBXCopyFilesBuildPhase'] || {};
let embedPhaseUuid = Object.keys(objects['PBXCopyFilesBuildPhase']).find(k => {
  if (k.endsWith('_comment')) return false;
  const p = objects['PBXCopyFilesBuildPhase'][k];
  return p.name?.includes('Embed App Extensions') || p.dstSubfolderSpec === '13';
});
if (!embedPhaseUuid) {
  embedPhaseUuid = uuid();
  objects['PBXCopyFilesBuildPhase'][embedPhaseUuid] = {
    isa: 'PBXCopyFilesBuildPhase',
    buildActionMask: '2147483647',
    dstPath: '""',
    dstSubfolderSpec: '13',
    files: [],
    name: '"Embed App Extensions"',
    runOnlyForDeploymentPostprocessing: '0',
  };
  objects['PBXCopyFilesBuildPhase'][`${embedPhaseUuid}_comment`] = 'Embed App Extensions';
  mainTarget.buildPhases = mainTarget.buildPhases || [];
  mainTarget.buildPhases.push({ value: embedPhaseUuid, comment: 'Embed App Extensions' });
  console.log('Added "Embed App Extensions" phase to main target.');
}
const embedPhase = objects['PBXCopyFilesBuildPhase'][embedPhaseUuid];
embedPhase.files = embedPhase.files || [];

const rootObject = project.hash.project.rootObject;
objects['PBXBuildFile'] = objects['PBXBuildFile'] || {};
objects['PBXContainerItemProxy'] = objects['PBXContainerItemProxy'] || {};
objects['PBXTargetDependency'] = objects['PBXTargetDependency'] || {};
mainTarget.dependencies = mainTarget.dependencies || [];

for (const extName of EXTENSIONS) {
  const appexPath = `${extName}.appex`;

  // Product file reference for the .appex.
  const productRefEntry = Object.entries(objects['PBXFileReference']).find(
    ([k, f]) => !k.endsWith('_comment') && f.path?.replace(/"/g, '') === appexPath,
  );
  if (!productRefEntry) {
    console.log(`⚠️  ${appexPath} product reference not found — run the add script first; skipping.`);
    continue;
  }
  const [productRefUuid] = productRefEntry;

  // Extension target uuid (for the dependency).
  const extTargetEntry = Object.entries(objects['PBXNativeTarget']).find(
    ([k, t]) => !k.endsWith('_comment') && t.name?.replace(/"/g, '') === extName,
  );
  if (!extTargetEntry) {
    console.log(`⚠️  Target ${extName} not found; skipping.`);
    continue;
  }
  const [extTargetUuid] = extTargetEntry;

  // Embed the .appex (skip if already embedded).
  const alreadyEmbedded = embedPhase.files.some(f => {
    const bf = objects['PBXBuildFile'][f.value];
    return bf?.fileRef === productRefUuid;
  });
  if (!alreadyEmbedded) {
    const buildFileUuid = uuid();
    objects['PBXBuildFile'][buildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: productRefUuid,
      fileRef_comment: appexPath,
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    };
    objects['PBXBuildFile'][`${buildFileUuid}_comment`] = `${appexPath} in Embed App Extensions`;
    embedPhase.files.push({ value: buildFileUuid, comment: `${appexPath} in Embed App Extensions` });
    console.log(`Embedded ${appexPath}.`);
  }

  // Target dependency (skip if already present).
  const alreadyDepends = mainTarget.dependencies.some(d => {
    const dep = objects['PBXTargetDependency'][d.value];
    return dep?.target === extTargetUuid;
  });
  if (!alreadyDepends) {
    const proxyUuid = uuid();
    objects['PBXContainerItemProxy'][proxyUuid] = {
      isa: 'PBXContainerItemProxy',
      containerPortal: rootObject,
      containerPortal_comment: 'Project object',
      proxyType: '1',
      remoteGlobalIDString: extTargetUuid,
      remoteInfo: `"${extName}"`,
    };
    objects['PBXContainerItemProxy'][`${proxyUuid}_comment`] = 'PBXContainerItemProxy';

    const depUuid = uuid();
    objects['PBXTargetDependency'][depUuid] = {
      isa: 'PBXTargetDependency',
      target: extTargetUuid,
      target_comment: extName,
      targetProxy: proxyUuid,
      targetProxy_comment: 'PBXContainerItemProxy',
    };
    objects['PBXTargetDependency'][`${depUuid}_comment`] = 'PBXTargetDependency';
    mainTarget.dependencies.push({ value: depUuid, comment: 'PBXTargetDependency' });
    console.log(`Added dependency ${MAIN_TARGET} → ${extName}.`);
  }
}

fs.writeFileSync(PROJ_PATH, project.writeSync());
console.log(`✅  Done — target ${mainTargetUuid} updated.`);
