import type { AiUsageSummary } from '../../domain/entities/AiUsage';
import type { IAiUsageReader } from '../../domain/interfaces';
import { summarizeAiUsage } from '../../domain/services/aiUsage';

/**
 * How much of today's AI budget is left, ready to render.
 *
 * A failed read is left to fail: a usage bar that shows a made-up number when
 * the server is unreachable is the one outcome worse than showing nothing.
 */
export class GetAiUsageUseCase {
  constructor(private readonly usage: IAiUsageReader) {}

  async execute(): Promise<AiUsageSummary> {
    return summarizeAiUsage(await this.usage.read());
  }
}
