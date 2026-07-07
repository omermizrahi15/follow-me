/**
 * Removes Info.plist from the extension targets' Resources build phases.
 * Info.plist is processed via INFOPLIST_FILE — also copying it as a bundle
 * resource makes Xcode produce the same output file twice (build error 65).
 * Idempotent. Run: node scripts/fix-extension-plists.js
 */
const xcode = require('../node_modules/xcode');
const fs = require('fs');
const path = require('path');

const PROJ_PATH = path.join(__dirname, '../ios/FollowMe.xcodeproj/project.pbxproj');
const EXTENSIONS = ['NotificationServiceExtension', 'NotificationContentExtension'];

const project = xcode.project(PROJ_PATH);
project.parseSync();
const objects = project.hash.project.objects;

let removed = 0;
for (const extName of EXTENSIONS) {
  const targetEntry = Object.entries(objects['PBXNativeTarget']).find(
    ([k, t]) => !k.endsWith('_comment') && t.name?.replace(/"/g, '') === extName,
  );
  if (!targetEntry) continue;
  const [, target] = targetEntry;

  for (const phaseRef of target.buildPhases ?? []) {
    const phase = objects['PBXResourcesBuildPhase']?.[phaseRef.value];
    if (!phase?.files) continue;
    phase.files = phase.files.filter(f => {
      const buildFile = objects['PBXBuildFile'][f.value];
      const fileRef = buildFile && objects['PBXFileReference'][buildFile.fileRef];
      const isPlist = fileRef?.path?.replace(/"/g, '') === 'Info.plist';
      if (isPlist) {
        delete objects['PBXBuildFile'][f.value];
        delete objects['PBXBuildFile'][`${f.value}_comment`];
        removed++;
      }
      return !isPlist;
    });
  }
}

fs.writeFileSync(PROJ_PATH, project.writeSync());
console.log(`✅  Removed ${removed} Info.plist resource entr${removed === 1 ? 'y' : 'ies'}.`);
