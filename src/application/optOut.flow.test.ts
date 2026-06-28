// Integration flow test for subscriber-initiated opt-out (issue #15): exercises
// the real Subscribe / Revoke / Reactivate / ShareMedia use cases together over
// shared in-memory infra. Proves the lifecycle a subscriber experiences:
// they join and receive, reply STOP and stop receiving (audited + confirmed),
// then reply START and receive again.
//
// Hermetic — runs in the normal `npm test`. The real Supabase queries are
// covered by the *.integration.test.ts suites.

import { SubscribeUseCase } from './usecases/SubscribeUseCase';
import { ShareMediaUseCase } from './usecases/ShareMediaUseCase';
import { RevokeSubscriberUseCase } from './usecases/RevokeSubscriberUseCase';
import { ReactivateSubscriberUseCase } from './usecases/ReactivateSubscriberUseCase';
import {
  InMemoryMediaRepository,
  InMemorySubscriberRepository,
  InMemoryNotifier,
  InMemoryStorageService,
  InMemoryNotificationLog,
  InMemoryConfirmationSender,
} from '../test-support/fakes';

const PUBLISHER = 'publisher-1';
const HANDLE = '+972501112233';
const photos = [{ mediaId: 'm-1', localUri: 'file:///a.jpg', filename: 'a.jpg' }];

function makeSut(): {
  subscribe: SubscribeUseCase;
  share: ShareMediaUseCase;
  revoke: RevokeSubscriberUseCase;
  reactivate: ReactivateSubscriberUseCase;
  notifier: InMemoryNotifier;
  log: InMemoryNotificationLog;
  sender: InMemoryConfirmationSender;
} {
  const subscriberRepo = new InMemorySubscriberRepository();
  const notifier = new InMemoryNotifier();
  const log = new InMemoryNotificationLog();
  const sender = new InMemoryConfirmationSender();

  const subscribe = new SubscribeUseCase(subscriberRepo);
  const share = new ShareMediaUseCase(
    new InMemoryMediaRepository(),
    subscriberRepo,
    notifier,
    new InMemoryStorageService(),
  );
  const revoke = new RevokeSubscriberUseCase(subscriberRepo, log, sender);
  const reactivate = new ReactivateSubscriberUseCase(subscriberRepo, log, sender);
  return { subscribe, share, revoke, reactivate, notifier, log, sender };
}

describe('Opt-out flow: subscribe → STOP stops delivery → START resumes it', () => {
  it('stops delivering after STOP and resumes after START', async (): Promise<void> => {
    const { subscribe, share, revoke, reactivate, notifier } = makeSut();

    await subscribe.subscribe({
      subscriberId: 'sub-1',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: HANDLE,
    });

    // Active → delivered.
    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.sent).toHaveLength(1);

    // STOP → revoked → no longer delivered.
    await revoke.revoke({ contactHandle: HANDLE, publisherName: 'Omer', detail: 'STOP' });
    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.sent).toHaveLength(1); // unchanged

    // START → active again → delivered.
    await reactivate.reactivate({ contactHandle: HANDLE, publisherName: 'Omer', detail: 'START' });
    await share.share({ ownerId: PUBLISHER, items: photos });
    expect(notifier.sent).toHaveLength(2);
  });

  it('audits the opt-out then the opt-in, in order', async (): Promise<void> => {
    const { subscribe, revoke, reactivate, log } = makeSut();

    await subscribe.subscribe({
      subscriberId: 'sub-1',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: HANDLE,
    });

    await revoke.revoke({ contactHandle: HANDLE, publisherName: 'Omer', detail: 'STOP' });
    await reactivate.reactivate({ contactHandle: HANDLE, publisherName: 'Omer', detail: 'START' });

    const entries = await log.findByContact(HANDLE);
    expect(entries.map(e => e.event)).toEqual(['opt_out', 'opt_in']);
  });

  it('confirms the unsubscribe to the subscriber', async (): Promise<void> => {
    const { subscribe, revoke, sender } = makeSut();

    await subscribe.subscribe({
      subscriberId: 'sub-1',
      publisherId: PUBLISHER,
      publisherName: 'Omer',
      contactHandle: HANDLE,
    });
    await revoke.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(sender.sentOf('unsubscribe')).toHaveLength(1);
  });
});
