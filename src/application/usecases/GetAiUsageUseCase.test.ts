import { GetAiUsageUseCase } from './GetAiUsageUseCase';
import type { IAiUsageReader } from '../../domain/interfaces';

function reader(used: number, limit: number): IAiUsageReader {
  return { read: () => Promise.resolve({ used, limit, day: '2026-08-28' }) };
}

describe('GetAiUsageUseCase', () => {
  it('summarises what the server reports', async () => {
    const summary = await new GetAiUsageUseCase(reader(400, 500)).execute();

    expect(summary).toEqual({
      used: 400,
      limit: 500,
      day: '2026-08-28',
      provider: null,
      remaining: 100,
      usedFraction: 0.8,
      usedPercent: 80,
      level: 'low',
    });
  });

  it('lets a failed read surface', async () => {
    const failing: IAiUsageReader = { read: () => Promise.reject(new Error('offline')) };

    await expect(new GetAiUsageUseCase(failing).execute()).rejects.toThrow('offline');
  });
});
