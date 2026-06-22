// Integration flow test: exercises the real use cases together (Subscribe ->
// ShareMedia -> RemoveSubscriber) over a shared repository, rather than each
// use case in isolation. Proves the lifecycle a publisher actually cares about:
// a follower who subscribes receives photos, and once removed they stop.
//
// Hermetic (in-memory infra, no creds) so it runs in the normal `npm test`.
// The real Supabase status filtering is covered separately by
// SupabaseSubscriberRepository.integration.test.ts.

import { SubscribeUseCase } from './usecases/SubscribeUseCase';
import { ShareMediaUseCase } from './usecases/ShareMediaUseCase';
import { RemoveSubscriberUseCase } from './usecases/RemoveSubscriberUseCase';
import {
  InMemoryMediaRepository,
  InMemorySubscriberRepository,
  InMemoryNotifier,
  InMemoryStorageService,
} from '../test-support/fakes';

const PUBLISHER = 'publisher-1';
const photos = [{ mediaId: 'm-1', localUri: 'file:///a.jpg', filename: 'a.jpg' }];

function makeSut(): {
  subscribe: SubscribeUseCase;
  share: ShareMediaUseCase;
  remove: RemoveSubscriberUseCase;
  notifier: InMemoryNotifier;
} {
  // One shared subscriber repository is the whole point — the use cases
  // collaborate through it.
  const subscriberRepo = new InMemorySubscriberRepository();
  const notifier = new InMemoryNotifier();

  const subscribe = new SubscribeUseCase(subscriberRepo);
  const share = new ShareMediaUseCase(
    new InMemoryMediaRepository(),
    subscriberRepo,
    notifier,
    new InMemoryStorageService(),
  );
  const remove = new RemoveSubscriberUseCase(subscriberRepo);
  return { subscribe, share, remove, notifier };
}

describe('Subscriber lifecycle flow: subscribe → receive → removed → stop receiving', () => {
  it('delivers to an active follower, then stops after removal', async (): Promise<void> => {
    const { subscribe, share, remove, notifier } = makeSut();

    // 1. Follower joins via the subscribe use case.
    const follower = await subscribe.subscribe({
      subscriberId: 'sub-1',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: '+972501112233',
    });

    // 2. Publisher shares — the active follower is notified.
    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.wasNotified('sub-1')).toBe(true);
    expect(notifier.sent).toHaveLength(1);

    // 3. Publisher removes the follower.
    await remove.remove({ publisherId: PUBLISHER, subscriberId: follower.id });

    // 4. Publisher shares again — the removed follower is NOT notified.
    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.sent).toHaveLength(1); // still 1 — no new delivery
  });

  it('removes only the targeted follower; others keep receiving', async (): Promise<void> => {
    const { subscribe, share, remove, notifier } = makeSut();

    await subscribe.subscribe({
      subscriberId: 'keep',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: '+972500000001',
    });
    await subscribe.subscribe({
      subscriberId: 'drop',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: '+972500000002',
    });

    // Both notified on the first share.
    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.wasNotified('keep')).toBe(true);
    expect(notifier.wasNotified('drop')).toBe(true);
    expect(notifier.sent).toHaveLength(2);

    // Remove one follower, then share again.
    await remove.remove({ publisherId: PUBLISHER, subscriberId: 'drop' });
    await share.share({ ownerId: PUBLISHER, items: photos });

    // Only the kept follower got the second delivery (2 + 1 = 3 total).
    expect(notifier.sent).toHaveLength(3);
    const droppedDeliveries = notifier.sent.filter(n => n.subscriber.id === 'drop');
    const keptDeliveries = notifier.sent.filter(n => n.subscriber.id === 'keep');
    expect(droppedDeliveries).toHaveLength(1); // only the first share
    expect(keptDeliveries).toHaveLength(2); // both shares
  });

  it('a removed follower can re-subscribe and receive again', async (): Promise<void> => {
    const { subscribe, share, remove, notifier } = makeSut();

    await subscribe.subscribe({
      subscriberId: 'sub-1',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: '+972501112233',
    });
    await remove.remove({ publisherId: PUBLISHER, subscriberId: 'sub-1' });

    // Re-subscribe with the same contact handle (reactivates, no duplicate).
    await subscribe.subscribe({
      subscriberId: 'sub-1-again',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: '+972501112233',
    });

    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.sent).toHaveLength(1); // delivered again after re-subscribe
  });
});
