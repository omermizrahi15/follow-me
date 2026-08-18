// Static `process.env.EXPO_PUBLIC_*` reference so Expo inlines the value into the
// bundle — a dynamic/bracket lookup would be undefined at runtime.
const APP_VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT as string | undefined;

/**
 * Whether to surface dev-only affordances — e.g. the "fire a test notification"
 * buttons in the auto-posting settings. True in local dev AND on the staging
 * build (so QA can trigger the rich approval push on a real staging device),
 * but never in production.
 *
 * This is the *runtime* half of the rule and no longer the part that matters
 * most: a boolean can hide a component but cannot keep it out of the bundle.
 * `metro.config.js` applies the same condition at resolution time and swaps the
 * dev panel for a stub, so in production the code behind this flag is not
 * shipped at all. Keep the two conditions in step.
 */
export const showDevTools = __DEV__ || APP_VARIANT === 'staging';
