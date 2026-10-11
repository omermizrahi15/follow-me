import { PreGradePhotosUseCase } from './PreGradePhotosUseCase';
import { GradingCoordinator } from '../services/GradingCoordinator';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { SuggestResult } from './SuggestPhotosUseCase';

const config = PublisherConfig.create({ publisherId: 'pub-1', frequency: 'weekly', photosPerPost: 5, requireApproval: true });

function result(over: Partial<SuggestResult['stats']> = {}): SuggestResult {
  return {
    batch: [], pool: [],
    stats: { scanned: 10, unique: 10, graded: 10, unreadable: 0, quotaExhausted: false, rateLimited: false, timedOut: false, ...over },
  } as SuggestResult;
}

describe('PreGradePhotosUseCase', () => {
  it('runs a quiet scan with a bounded budget', async () => {
    const execute = jest.fn<Promise<SuggestResult>, unknown[]>().mockResolvedValue(result());
    const outcome = await new PreGradePhotosUseCase({ execute }, new GradingCoordinator(), 40).execute(config);
    expect(outcome).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[3]).toMatchObject({ maxGrades: 40 });
  });

  it('does nothing while the publisher is in a live scan', async () => {
    const execute = jest.fn();
    const coordinator = new GradingCoordinator();
    const release = await coordinator.beginInteractive();
    const outcome = await new PreGradePhotosUseCase({ execute }, coordinator, 40).execute(config);
    expect(outcome).toBe('busy');
    expect(execute).not.toHaveBeenCalled();
    release();
  });

  it('yields to a live scan that starts mid-run', async () => {
    const coordinator = new GradingCoordinator();
    let seenStop: (() => boolean) | undefined;
    const execute = jest.fn((_c, _p, _w, opts: { shouldStop: () => boolean }) => {
      seenStop = opts.shouldStop;
      return Promise.resolve(result());
    });
    const run = new PreGradePhotosUseCase({ execute }, coordinator, 40).execute(config);
    const live = coordinator.beginInteractive();
    await run;
    expect(seenStop?.()).toBe(true);
    (await live)();
  });

  it('reports a wall so the caller can back off', async () => {
    const execute = jest.fn().mockResolvedValue(result({ quotaExhausted: true }));
    expect(await new PreGradePhotosUseCase({ execute }, new GradingCoordinator(), 40).execute(config)).toBe('walled');
    execute.mockResolvedValue(result({ rateLimited: true }));
    expect(await new PreGradePhotosUseCase({ execute }, new GradingCoordinator(), 40).execute(config)).toBe('walled');
  });

  it('frees the slot even when the scan throws', async () => {
    const coordinator = new GradingCoordinator();
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(new PreGradePhotosUseCase({ execute }, coordinator, 40).execute(config)).rejects.toThrow('boom');
    expect(coordinator.tryBeginBackground()).not.toBeNull();
  });
});
