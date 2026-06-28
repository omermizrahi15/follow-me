import { ReactivateSubscriberUseCase } from './ReactivateSubscriberUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import {
  InMemorySubscriberRepository,
  InMemoryNotificationLog,
  InMemoryConfirmationSender,
} from '../../test-support/fakes';

const HANDLE = '+972501234567';

function makeSut(): {
  useCase: ReactivateSubscriberUseCase;
  repo: InMemorySubscriberRepository;
  log: InMemoryNotificationLog;
  sender: InMemoryConfirmationSender;
} {
  const repo = new InMemorySubscriberRepository();
  const log = new InMemoryNotificationLog();
  const sender = new InMemoryConfirmationSender();
  const useCase = new ReactivateSubscriberUseCase(repo, log, sender);
  return { useCase, repo, log, sender };
}

async function seed(
  repo: InMemorySubscriberRepository,
  props: { id: string; publisherId: string; contactHandle: string; status: 'active' | 'revoked' | 'pending' },
): Promise<void> {
  await repo.save(Subscriber.create(props));
}

describe('ReactivateSubscriberUseCase', () => {
  it('re-activates a previously revoked subscriber', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'revoked' });

    const result = await useCase.reactivate({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(result.reactivated).toHaveLength(1);
    expect((await repo.findById('sub-1'))!.status).toBe('active');
  });

  it('records an opt_in audit entry', async (): Promise<void> => {
    const { useCase, repo, log } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'revoked' });

    await useCase.reactivate({ contactHandle: HANDLE, publisherName: 'Omer', detail: 'START' });

    const entries = await log.findByContact(HANDLE);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ event: 'opt_in', subscriberId: 'sub-1', detail: 'START' });
  });

  it('sends a resubscribe confirmation', async (): Promise<void> => {
    const { useCase, repo, sender } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'revoked' });

    await useCase.reactivate({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(sender.sentOf('resubscribe')).toEqual([{ contactHandle: HANDLE, publisherName: 'Omer' }]);
  });

  it('does not change an already-active subscriber and writes no audit entry', async (): Promise<void> => {
    const { useCase, repo, log } = makeSut();
    await seed(repo, { id: 'sub-1', publisherId: 'pub-1', contactHandle: HANDLE, status: 'active' });

    const result = await useCase.reactivate({ contactHandle: HANDLE, publisherName: 'Omer' });

    expect(result.reactivated).toHaveLength(0);
    expect(log.ofEvent('opt_in')).toHaveLength(0);
    expect((await repo.findById('sub-1'))!.status).toBe('active');
  });

  it('stays silent and writes nothing for an unknown number', async (): Promise<void> => {
    const { useCase, log, sender } = makeSut();

    const result = await useCase.reactivate({ contactHandle: '+19999999999', publisherName: 'Omer' });

    expect(result.reactivated).toHaveLength(0);
    expect(log.entries).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });
});
