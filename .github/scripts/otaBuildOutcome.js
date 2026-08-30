// Outcome classification for the OTA rebuild check, kept separate from the
// script so it can be tested without spending an EAS build. CommonJS on purpose:
// ota-rebuild-check.mjs imports it as ESM, and jest requires it directly.

// Builds that could still become compatible — no point starting a second one.
const PENDING = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS']);
// ...and the states EAS is finished with, whatever the outcome.
const TERMINAL = new Set(['FINISHED', 'ERRORED', 'CANCELED']);

// Failures that belong to EAS, not to this commit. `SERVER_ERROR` is what EAS
// reports when the build itself completed and the platform then failed around it
// — build 4b5a01af compiled for 4.6 minutes and errored with "Failed to upload
// application archive", carrying no logsUrl because there was nothing wrong to
// log. Rebuilding the same commit is the correct response; telling the author to
// go run it on their machine is not.
//
// Deliberately a narrow allowlist. Every other ERRORED build is the author's to
// fix, and retrying one only spends a second build to fail identically.
const INFRASTRUCTURE_ERROR_CODES = new Set(['SERVER_ERROR']);

const isInfrastructureFailure = (build) =>
  build?.status === 'ERRORED' && INFRASTRUCTURE_ERROR_CODES.has(build?.error?.errorCode);

module.exports = { PENDING, TERMINAL, INFRASTRUCTURE_ERROR_CODES, isInfrastructureFailure };
