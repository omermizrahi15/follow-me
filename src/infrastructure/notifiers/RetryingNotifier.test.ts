import { RetryingNotifier } from './RetryingNotifier';
import { Media } from '../../domain/entities/Media';
import { Subscriber } from '../../domain/entities/Subscriber';
import type { INotifier } from '../../domain/interfaces';

const subscriber = Subscriber.create({
  id: 'sub-1',
  publisherId: 'user-1',
  contactHandle: '+972501234567',
  status: 'active',
});

const media = [
  Media.create({
    id: 'media-1',
    ownerId: 'user-1',
    url: 'https://cdn.test/a.jpg',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    postingId: 'posting-1',
  }),
];

/** INotifier that fails the first `failures` calls, then succeeds. */
class FlakyNotifier implements INotifier {
  calls = 0;
  constructor(private readonly failures: number) {}

  notify(): Promise<void> {
    this.calls++;
    if (this.calls <= this.failures) {
      return Promise.reject(new Error(`send failed (call ${this.calls})`));
    }
    return Promise.resolve();
  }
}

function makeSut(failures: number, onAttempt?: (subscriber: Subscriber, media: Media[], attempt: number) => Promise<void>): {
  notifier: RetryingNotifier;
  inner: FlakyNotifier;
  sleeps: number[];
} {
  const inner = new FlakyNotifier(failures);
  const sleeps: number[] = [];
  const notifier = new RetryingNotifier(inner, {
    sleep: ms => { sleeps.push(ms); return Promise.resolve(); },
    ...(onAttempt != null ? { onAttempt } : {}),
  });
  return { notifier, inner, sleeps };
}

describe('RetryingNotifier', () => {
  it('delivers on the first attempt without sleeping', async (): Promise<void> => {
    const { notifier, inner, sleeps } = makeSut(0);
    await notifier.notify(subscriber, media);
    expect(inner.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries after a failure and succeeds', async (): Promise<void> => {
    const { notifier, inner, sleeps } = makeSut(1);
    await notifier.notify(subscriber, media);
    expect(inner.calls).toBe(2);
    expect(sleeps).toEqual([1_000]);
  });

  it('backs off exponentially: 1s, 4s, 16s', async (): Promise<void> => {
    const { notifier, inner, sleeps } = makeSut(3);
    await notifier.notify(subscriber, media);
    expect(inner.calls).toBe(4);
    expect(sleeps).toEqual([1_000, 4_000, 16_000]);
  });

  it('gives up after the retries are exhausted and rethrows the last error', async (): Promise<void> => {
    const { notifier, inner, sleeps } = makeSut(Infinity);
    await expect(notifier.notify(subscriber, media)).rejects.toThrow('send failed (call 4)');
    expect(inner.calls).toBe(4);
    expect(sleeps).toEqual([1_000, 4_000, 16_000]);
  });

  it('reports each attempt to the observer before sending', async (): Promise<void> => {
    const attempts: number[] = [];
    const { notifier } = makeSut(2, (_s, _m, attempt) => { attempts.push(attempt); return Promise.resolve(); });
    await notifier.notify(subscriber, media);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it('still delivers when the attempt observer throws', async (): Promise<void> => {
    const { notifier, inner } = makeSut(0, () => Promise.reject(new Error('log db down')));
    await notifier.notify(subscriber, media);
    expect(inner.calls).toBe(1);
  });
});
