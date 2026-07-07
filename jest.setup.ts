import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

// React Native defines __DEV__ globally; mirror it for code under test.
(globalThis as Record<string, unknown>).__DEV__ = false;
