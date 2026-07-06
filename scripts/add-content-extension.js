/**
 * Adds the NotificationContentExtension target (custom expanded notification UI
 * — the photo grid) to the Xcode project.
 * Run once: node scripts/add-content-extension.js
 */
const xcode = require('../node_modules/xcode');
const fs = require('fs');
const path = require('path');

const PROJ_PATH = path.join(__dirname, '../ios/FollowMe.xcodeproj/project.pbxproj');
const MAIN_BUNDLE_ID = 'com.urishiber.followmedev17';
const EXT_BUNDLE_ID = `${MAIN_BUNDLE_ID}.NotificationContent`;
const EXT_TARGET = 'NotificationContentExtension';
const SWIFT_FILE = 'NotificationViewController.swift';
const DEV_TEAM = '458VBLF2C4';

// Copy the extension sources from the tracked native/ folder into the
// gitignored ios/ directory (refreshed on every run, so edits to native/
// propagate even when the target already exists).
const srcDir = path.join(__dirname, '../native', EXT_TARGET);
const destDir = path.join(__dirname, '../ios', EXT_TARGET);
fs.mkdirSync(destDir, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
}
console.log(`Copied ${EXT_TARGET} sources from native/ into ios/.`);

const project = xcode.project(PROJ_PATH);
project.parseSync();

// Guard: don't add twice.
if (project.pbxTargetByName(EXT_TARGET)) {
  console.log('Content extension target already present, skipping.');
  process.exit(0);
}

function uuid() {
  return project.generateUuid();
}

const objects = project.hash.project.objects;

// --- 1. PBXFileReference entries ---
const swiftFileRef = uuid();
const plistFileRef = uuid();

objects['PBXFileReference'] = objects['PBXFileReference'] || {};
objects['PBXFileReference'][swiftFileRef] = {
  isa: 'PBXFileReference',
  lastKnownFileType: 'sourcecode.swift',
  path: `"${SWIFT_FILE}"`,
  sourceTree: '"<group>"',
};
objects['PBXFileReference'][`${swiftFileRef}_comment`] = SWIFT_FILE;
objects['PBXFileReference'][plistFileRef] = {
  isa: 'PBXFileReference',
  lastKnownFileType: 'text.plist.xml',
  path: '"Info.plist"',
  sourceTree: '"<group>"',
};
objects['PBXFileReference'][`${plistFileRef}_comment`] = 'Info.plist';

// --- 2. PBXGroup for the extension ---
const groupUuid = uuid();
objects['PBXGroup'] = objects['PBXGroup'] || {};
objects['PBXGroup'][groupUuid] = {
  isa: 'PBXGroup',
  children: [
    { value: swiftFileRef, comment: SWIFT_FILE },
    { value: plistFileRef, comment: 'Info.plist' },
  ],
  path: `"${EXT_TARGET}"`,
  sourceTree: '"<group>"',
};
objects['PBXGroup'][`${groupUuid}_comment`] = EXT_TARGET;

// Attach group to the main project group.
const mainGroupKey = project.findPBXGroupKey({ name: 'FollowMe' })
  || Object.keys(objects['PBXGroup']).find(k => {
    const g = objects['PBXGroup'][k];
    return g && g.isa === 'PBXGroup' && !k.endsWith('_comment') && !g.path && !g.name;
  });
if (mainGroupKey) {
  const mainGroup = objects['PBXGroup'][mainGroupKey];
  mainGroup.children = mainGroup.children || [];
  mainGroup.children.push({ value: groupUuid, comment: EXT_TARGET });
}

// --- 3. PBXBuildFile entries ---
// NOTE: Info.plist must NOT get a build file — it's processed via INFOPLIST_FILE;
// also copying it as a bundle resource makes Xcode emit it twice (error 65).
const swiftBuildFile = uuid();

objects['PBXBuildFile'] = objects['PBXBuildFile'] || {};
objects['PBXBuildFile'][swiftBuildFile] = {
  isa: 'PBXBuildFile',
  fileRef: swiftFileRef,
  fileRef_comment: SWIFT_FILE,
};
objects['PBXBuildFile'][`${swiftBuildFile}_comment`] = `${SWIFT_FILE} in Sources`;

// --- 4. Build phases ---
const sourcePhaseUuid = uuid();
const resourcePhaseUuid = uuid();
const frameworkPhaseUuid = uuid();

objects['PBXSourcesBuildPhase'] = objects['PBXSourcesBuildPhase'] || {};
objects['PBXSourcesBuildPhase'][sourcePhaseUuid] = {
  isa: 'PBXSourcesBuildPhase',
  buildActionMask: '2147483647',
  files: [{ value: swiftBuildFile, comment: `${SWIFT_FILE} in Sources` }],
  runOnlyForDeploymentPostprocessing: '0',
};
objects['PBXSourcesBuildPhase'][`${sourcePhaseUuid}_comment`] = 'Sources';

objects['PBXResourcesBuildPhase'] = objects['PBXResourcesBuildPhase'] || {};
objects['PBXResourcesBuildPhase'][resourcePhaseUuid] = {
  isa: 'PBXResourcesBuildPhase',
  buildActionMask: '2147483647',
  files: [],
  runOnlyForDeploymentPostprocessing: '0',
};
objects['PBXResourcesBuildPhase'][`${resourcePhaseUuid}_comment`] = 'Resources';

objects['PBXFrameworksBuildPhase'] = objects['PBXFrameworksBuildPhase'] || {};
objects['PBXFrameworksBuildPhase'][frameworkPhaseUuid] = {
  isa: 'PBXFrameworksBuildPhase',
  buildActionMask: '2147483647',
  files: [],
  runOnlyForDeploymentPostprocessing: '0',
};
objects['PBXFrameworksBuildPhase'][`${frameworkPhaseUuid}_comment`] = 'Frameworks';

// --- 5. XCBuildConfiguration for Debug and Release ---
const debugConfigUuid = uuid();
const releaseConfigUuid = uuid();

const commonSettings = {
  CLANG_ENABLE_MODULES: 'YES',
  DEVELOPMENT_TEAM: DEV_TEAM,
  INFOPLIST_FILE: `"${EXT_TARGET}/Info.plist"`,
  LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
  PRODUCT_BUNDLE_IDENTIFIER: `"${EXT_BUNDLE_ID}"`,
  PRODUCT_NAME: `"$(TARGET_NAME)"`,
  SKIP_INSTALL: 'YES',
  SWIFT_VERSION: '5.0',
  TARGETED_DEVICE_FAMILY: '"1,2"',
};

objects['XCBuildConfiguration'] = objects['XCBuildConfiguration'] || {};
objects['XCBuildConfiguration'][debugConfigUuid] = {
  isa: 'XCBuildConfiguration',
  buildSettings: { ...commonSettings, DEBUG_INFORMATION_FORMAT: 'dwarf' },
  name: 'Debug',
};
objects['XCBuildConfiguration'][`${debugConfigUuid}_comment`] = 'Debug';
objects['XCBuildConfiguration'][releaseConfigUuid] = {
  isa: 'XCBuildConfiguration',
  buildSettings: { ...commonSettings, DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"' },
  name: 'Release',
};
objects['XCBuildConfiguration'][`${releaseConfigUuid}_comment`] = 'Release';

// --- 6. XCConfigurationList ---
const configListUuid = uuid();
objects['XCConfigurationList'] = objects['XCConfigurationList'] || {};
objects['XCConfigurationList'][configListUuid] = {
  isa: 'XCConfigurationList',
  buildConfigurations: [
    { value: debugConfigUuid, comment: 'Debug' },
    { value: releaseConfigUuid, comment: 'Release' },
  ],
  defaultConfigurationIsVisible: '0',
  defaultConfigurationName: 'Release',
};
objects['XCConfigurationList'][`${configListUuid}_comment`] = `Build configuration list for PBXNativeTarget "${EXT_TARGET}"`;

// --- 7. PBXNativeTarget ---
const targetUuid = uuid();
objects['PBXNativeTarget'] = objects['PBXNativeTarget'] || {};
objects['PBXNativeTarget'][targetUuid] = {
  isa: 'PBXNativeTarget',
  buildConfigurationList: configListUuid,
  buildConfigurationList_comment: `Build configuration list for PBXNativeTarget "${EXT_TARGET}"`,
  buildPhases: [
    { value: sourcePhaseUuid, comment: 'Sources' },
    { value: frameworkPhaseUuid, comment: 'Frameworks' },
    { value: resourcePhaseUuid, comment: 'Resources' },
  ],
  buildRules: [],
  dependencies: [],
  name: `"${EXT_TARGET}"`,
  productName: `"${EXT_TARGET}"`,
  productReference: (() => {
    const productRef = uuid();
    objects['PBXFileReference'][productRef] = {
      isa: 'PBXFileReference',
      explicitFileType: 'wrapper.app-extension',
      includeInIndex: '0',
      path: `"${EXT_TARGET}.appex"`,
      sourceTree: 'BUILT_PRODUCTS_DIR',
    };
    objects['PBXFileReference'][`${productRef}_comment`] = `${EXT_TARGET}.appex`;
    const productsGroupKey = project.findPBXGroupKey({ name: 'Products' });
    if (productsGroupKey) {
      objects['PBXGroup'][productsGroupKey].children.push({
        value: productRef,
        comment: `${EXT_TARGET}.appex`,
      });
    }
    return productRef;
  })(),
  productReference_comment: `${EXT_TARGET}.appex`,
  productType: '"com.apple.product-type.app-extension"',
};
objects['PBXNativeTarget'][`${targetUuid}_comment`] = EXT_TARGET;

// --- 8. Add target to the PBXProject ---
const projectSection = project.hash.project.objects['PBXProject'];
const projectKey = Object.keys(projectSection).find(k => !k.endsWith('_comment'));
if (projectKey) {
  const proj = projectSection[projectKey];
  proj.targets = proj.targets || [];
  proj.targets.push({ value: targetUuid, comment: EXT_TARGET });
}

// --- 9. Write ---
fs.writeFileSync(PROJ_PATH, project.writeSync());
console.log(`✅  ${EXT_TARGET} target added to project.pbxproj`);
console.log(`   Bundle ID: ${EXT_BUNDLE_ID}`);
console.log(`   Dev Team:  ${DEV_TEAM}`);
