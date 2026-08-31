/**
 * Local typing for `expo-file-system/legacy`, which ships as raw TypeScript
 * (legacy.ts → src/legacy/*.ts). Without this shim, tsc compiles the library
 * source with this repo's `exactOptionalPropertyTypes` flag — which Expo's
 * code doesn't satisfy — and typecheck fails. Mapped via tsconfig `paths`;
 * Metro still resolves the real module at runtime.
 * Only the APIs this app uses are declared — extend as needed.
 */
declare module 'expo-file-system/legacy' {
  export const cacheDirectory: string | null;
  export const documentDirectory: string | null;

  export enum EncodingType {
    UTF8 = 'utf8',
    Base64 = 'base64',
  }

  export interface DownloadResult {
    uri: string;
    status: number;
    headers: Record<string, string>;
    mimeType: string | null;
  }

  export function downloadAsync(
    uri: string,
    fileUri: string,
    options?: Record<string, unknown>,
  ): Promise<DownloadResult>;

  export function copyAsync(options: { from: string; to: string }): Promise<void>;

  export interface FileInfo {
    exists: boolean;
    uri: string;
    /** Present only when `getInfoAsync` was asked for it. */
    size?: number;
    isDirectory?: boolean;
    modificationTime?: number;
  }

  export function getInfoAsync(
    fileUri: string,
    options?: { size?: boolean; md5?: boolean },
  ): Promise<FileInfo>;

  export function readAsStringAsync(
    fileUri: string,
    options?: { encoding?: EncodingType | 'utf8' | 'base64' },
  ): Promise<string>;
}
