/**
 * Asserts an EXPO_PUBLIC_* build-time variable is present. Callers MUST pass the
 * value via a static `process.env.EXPO_PUBLIC_X` reference (never a dynamic
 * `process.env[key]`): Expo only inlines static references into the production
 * bundle, so a dynamic lookup is `undefined` at runtime and blanks the app.
 */
export function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
