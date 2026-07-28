// Decides whether a diff needs a fresh native `eas build` or can ride an
// over-the-air EAS Update. OTA can only swap JS/assets; native modules and
// app-config changes are compiled into the binary and must be rebuilt +
// reinstalled. Emits a GitHub job summary + ::warning:: annotations. Never
// fails the build — it only warns.

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fileAt = (ref, path) => {
  try { return execSync(`git show ${ref}:${path}`, { encoding: 'utf8' }); }
  catch { return null; } // absent at that ref
};

// Two modes: CI diffs BASE_SHA..HEAD_SHA (a PR); STAGED=1 diffs HEAD..index
// (the pre-commit hook, warning at commit time). `git show :path` reads the
// staged copy of a file.
let changed, mergeBase, head;
if (process.env.STAGED === '1') {
  mergeBase = 'HEAD';
  head = ''; // `git show :path` = the index
  changed = sh('git diff --cached --name-only').split('\n').filter(Boolean);
} else {
  const base = process.env.BASE_SHA || 'origin/main';
  head = process.env.HEAD_SHA || 'HEAD';
  try { mergeBase = sh(`git merge-base ${base} ${head}`); }
  catch { mergeBase = base; }
  changed = sh(`git diff --name-only ${mergeBase} ${head}`).split('\n').filter(Boolean);
}

const rebuild = []; // reasons a native rebuild is required
const notes = [];   // informational (OTA still fine)

// Heuristic: most expo-* and react-native-* packages carry native code. Framed
// as "likely" — the exact package list is printed so a human can confirm.
// A few common packages match the prefix but are pure JS; exclude them.
const KNOWN_JS_ONLY = new Set(['react-native-web']);
const likelyNative = (name) =>
  !KNOWN_JS_ONLY.has(name) &&
  (/^expo-/.test(name) || /^@react-native-/.test(name) || /^react-native(-|$)/.test(name));

// --- runtime dependencies (devDependencies don't ship in the app) ---
if (changed.includes('package.json')) {
  const depsAt = (ref) => {
    const raw = fileAt(ref, 'package.json');
    if (!raw) return {};
    try { return JSON.parse(raw).dependencies ?? {}; } catch { return {}; }
  };
  const before = depsAt(mergeBase);
  const after = depsAt(head);
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const native = [];
  const other = [];
  for (const n of names) {
    if (before[n] === after[n]) continue;
    const line = !(n in before) ? `+ ${n}@${after[n]}`
      : !(n in after) ? `- ${n} (removed)`
      : `~ ${n}: ${before[n]} → ${after[n]}`;
    (likelyNative(n) ? native : other).push(line);
  }
  if (native.length) {
    rebuild.push({
      title: 'Native dependency change',
      detail: 'A native module was added, removed, or version-bumped. OTA cannot swap native code, so the installed binary must be rebuilt:\n\n' +
        native.map((l) => '    ' + l).join('\n'),
    });
  }
  if (other.length) {
    notes.push('Dependency change that looks JS-only (OTA should be fine, but confirm the package ships no native code):\n\n' +
      other.map((l) => '    ' + l).join('\n'));
  }
}

// --- app.json (version == runtimeVersion, plus native config) ---
if (changed.includes('app.json')) {
  const versionAt = (ref) => {
    const raw = fileAt(ref, 'app.json');
    try { return raw ? (JSON.parse(raw).expo?.version ?? null) : null; } catch { return null; }
  };
  const vb = versionAt(mergeBase);
  const va = versionAt(head);
  if (vb !== va) {
    rebuild.push({
      title: `App version bump (${vb} → ${va})`,
      detail: 'A new user-facing version belongs in a binary: existing installs keep reporting the old version no matter what the OTA carries. Ship it with an `eas build`.',
    });
  } else {
    rebuild.push({
      title: 'Native app config changed (app.json)',
      detail: 'app.json holds native settings (ios config, plugins, permissions, entitlements, icon, scheme). These are compiled into the binary, not delivered over-the-air.',
    });
  }
}

// --- app.config.js (dynamic native config) ---
if (changed.includes('app.config.js')) {
  rebuild.push({
    title: 'Dynamic native config changed (app.config.js)',
    detail: 'app.config.js drives native settings (bundle id, scheme, runtimeVersion, updates URL, plugins). If the change touches any of those, a fresh `eas build` is required.',
  });
}

// --- prebuilt native project, if one is ever committed ---
if (changed.some((f) => f.startsWith('ios/'))) {
  rebuild.push({
    title: 'Native iOS project files changed (ios/**)',
    detail: 'Files under ios/ are part of the compiled app and require a rebuild.',
  });
}

// --- render ---
const out = [];
const unit = process.env.STAGED === '1' ? 'commit' : 'PR';
if (rebuild.length) {
  out.push('## ⚠️ Native rebuild likely needed');
  out.push('');
  out.push(`This ${unit} changes the **native layer**, so the automatic EAS Update (OTA) to staging on merge will **not** fully deliver it. After merging, rebuild and reinstall the staging app:`);
  out.push('');
  out.push('```bash');
  out.push('eas build --profile preview     # staging .ipa — install it, then OTA resumes as normal');
  out.push('```');
  out.push('');
  for (const r of rebuild) {
    out.push(`### ${r.title}`, '', r.detail, '');
  }
} else {
  out.push('## ✅ OTA is enough');
  out.push('');
  out.push('The matched files changed, but nothing that affects the native binary. Merging to `main` ships this via EAS Update (OTA) to staging automatically — no `eas build` needed.');
  out.push('');
}
if (notes.length) {
  out.push('### Notes', '');
  for (const n of notes) out.push(n, '');
}

const report = out.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
if (process.env.GITHUB_ACTIONS) {
  for (const r of rebuild) {
    console.log(`::warning title=Native rebuild needed::${r.title} — an OTA update won't deliver this; run 'eas build --profile preview' and reinstall staging.`);
  }
}
process.exit(0); // never block
