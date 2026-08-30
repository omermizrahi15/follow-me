import type { AiUsageSnapshot } from '../entities/AiUsage';

/**
 * Reads the day's AI budget as the server sees it.
 *
 * Both halves have to come from the server: the count lives in a table only the
 * Edge Function may touch, and the ceiling is that function's own env var. A
 * client that knew either number by itself would be guessing at the other, and
 * a usage bar that guesses is worse than no bar.
 */
export interface IAiUsageReader {
  /** The publisher's usage for the current server day. */
  read(): Promise<AiUsageSnapshot>;
}
