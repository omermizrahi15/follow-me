// Pure parsing/decision logic for the twilio-status webhook, split out of
// index.ts for unit testing. The DB write + signature check stay in index.ts.

import { isFailureStatus, isUnreachableErrorCode } from '../_shared/messageLog.ts';

/** Twilio ErrorCode as a number, or null when absent / non-numeric. */
export function parseErrorCode(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/** True when a delivery event means the recipient is permanently unreachable. */
export function shouldMarkUnreachable(status: string, errorCodeRaw: string): boolean {
  return isFailureStatus(status) && isUnreachableErrorCode(parseErrorCode(errorCodeRaw));
}
