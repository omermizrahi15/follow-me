import { RevokeSubscriberUseCase } from './RevokeSubscriberUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import {
  InMemorySubscriberRepository,
  InMemoryNotificationLog,
  InMemoryConfirmationSender,
} from '../../test-support/fakes';

const HANDLE = '+972501234567';

function makeSut(): {
  useCase: RevokeSubscriberUseCase;
  repo: InMemorySubscriberRepository;
  log: InMemoryNotificationLog;
  sender: InMemoryConfirmationSender;
} {
  const repo = new InMemorySubscriberRepository();
  const log = new InMemoryNotificationLog();
  const sender = new InMemoryConfirmationSender();
  const useCase = new RevokeSubscriberUseCase(repo, log, sender);
  return { useCase, repo, log, sender };
}

async function seed(
  repo: InMemorySubscriberRepository,
  props: { id: string; publisherId: string; contactHandle: string; status: 'active' | 'revoked' | 'pending' },
): Promise<void> {
  await repo.save(Subscriber.create(props));
}

describe('RevokeSubscriberUseCase', () => {
  it('revokes an active subscriber matching the contact handle', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'active' });

    const result = await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(result.revoked).toHaveLength(1);
    expect((await repo.findById('sub-1'))!.status).toBe('revoked');
  });

  it('records an opt_out audit entry for the revoked subscriber', async (): Promise<void> => {
    const { useCase, repo, log } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'active' });

    await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer', detail: 'STOP' });

    const entries = await log.findByContact(HANDLE);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      subscriberId: 'sub-1',
      publisherId: 'pub-1',
      contactHandle: HANDLE,
      event: 'opt_out',
      detail: 'STOP',
    });
  });

  it('sends one unsubscribe confirmation to the contact', async (): Promise<void> => {
    const { useCase, repo, sender } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'active' });

    await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(sender.sentOf('unsubscribe')).toEqual([{ contactHandle: HANDLE, publisherName: 'Omer' }]);
  });

  it('revokes every active subscription for the same number across publishers', async (): Promise<void> => {
    const { useCase, repo, log } = makeSut();
    await seed(repo, { id: 'a', publisherId: 'pub-1', contactHandle: HANDLE, status: 'active' });
    await seed(repo, { id: 'b', publisherId: 'pub-2', contactHandle: HANDLE, status: 'active' });

    const result = await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(result.revoked).toHaveLength(2);
    expect((await repo.findById('a'))!.status).toBe('revoked');
    expect((await repo.findById('b'))!.status).toBe('revoked');
    expect(log.ofEvent('opt_out')).toHaveLength(2);
  });

  it('leaves subscriptions for other numbers untouched', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await seed(repo, { id: 'mine', publisherId: 'pub-1', contactHandle: HANDLE, status: 'active' });
    await seed(repo, { id: 'other', publisherId: 'pub-1', contactHandle: '+10000000000', status: 'active' });

    await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect((await repo.findById('other'))!.status).toBe('active');
  });

  it('is idempotent: a repeat STOP on an already-revoked number writes no new audit entry', async (): Promise<void> => {
    const { useCase, repo, log } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'revoked' });

    const result = await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(result.revoked).toHaveLength(0);
    expect(log.ofEvent('opt_out')).toHaveLength(0);
  });

  it('still acknowledges a repeat STOP from a known (already-revoked) number', async (): Promise<void> => {
    const { useCase, repo, sender } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'revoked' });

    await useCase.revoke({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(sender.sentOf('unsubscribe')).toHaveLength(1);
  });

  it('stays silent and writes nothing for an unknown number', async (): Promise<void> => {
    const { useCase, log, sender } = makeSut();

    const result = await useCase.revoke({ contactHandle: '+19999999999', publisherName: 'Omer' });

    expect(result.revoked).toHaveLength(0);
    expect(log.entries).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });
});
