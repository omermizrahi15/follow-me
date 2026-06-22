import { JoinController, parsePublisherId, normalizeWhatsAppNumber } from './joinPage';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { Subscriber } from '../domain/entities/Subscriber';
import { InMemorySubscriberRepository } from '../test-support/fakes';

describe('parsePublisherId', () => {
  it('extracts the id from a join path', () => {
    expect(parsePublisherId('/join/abc-123')).toBe('abc-123');
  });

  it('tolerates a trailing slash, query string, and hash', () => {
    expect(parsePublisherId('/join/abc-123/')).toBe('abc-123');
    expect(parsePublisherId('/join/abc-123?ref=wa')).toBe('abc-123');
    expect(parsePublisherId('/join/abc-123#top')).toBe('abc-123');
  });

  it('decodes percent-encoded ids', () => {
    expect(parsePublisherId('/join/a%20b')).toBe('a b');
  });

  it('returns null when there is no join segment', () => {
    expect(parsePublisherId('/')).toBeNull();
    expect(parsePublisherId('/join')).toBeNull();
    expect(parsePublisherId('/join/')).toBeNull();
  });
});

describe('normalizeWhatsAppNumber', () => {
  it('passes through a valid E.164 number', () => {
    expect(normalizeWhatsAppNumber('+972501234567')).toBe('+972501234567');
  });

  it('adds a leading + when missing', () => {
    expect(normalizeWhatsAppNumber('972501234567')).toBe('+972501234567');
  });

  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizeWhatsAppNumber('+1 (415) 523-8886')).toBe('+14155238886');
  });

  it('rejects non-numbers and implausible input', () => {
    expect(normalizeWhatsAppNumber('not a phone')).toBeNull();
    expect(normalizeWhatsAppNumber('123')).toBeNull(); // too short
    expect(normalizeWhatsAppNumber('')).toBeNull();
    expect(normalizeWhatsAppNumber('+0123456789')).toBeNull(); // leading zero after +
  });
});

function makeSut(): {
  controller: JoinController;
  repo: InMemorySubscriberRepository;
} {
  const repo = new InMemorySubscriberRepository();
  const subscribe = new SubscribeUseCase(repo);
  let counter = 0;
  const controller = new JoinController(subscribe, () => `generated-id-${++counter}`);
  return { controller, repo };
}

describe('JoinController.submit', () => {
  it('subscribes the follower and reports success', async () => {
    const { controller, repo } = makeSut();

    const state = await controller.submit('pub-1', '+972501234567');

    expect(state).toEqual({ status: 'success', contactHandle: '+972501234567' });
    const saved = await repo.findActiveByPublisher('pub-1');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.contactHandle).toBe('+972501234567');
  });

  it('normalizes the number before subscribing', async () => {
    const { controller, repo } = makeSut();

    await controller.submit('pub-1', '972 50 123 4567');

    const saved = await repo.findActiveByPublisher('pub-1');
    expect(saved[0]?.contactHandle).toBe('+972501234567');
  });

  it('is idempotent — re-subscribing an active follower stays success with no duplicate', async () => {
    const { controller, repo } = makeSut();

    await controller.submit('pub-1', '+972501234567');
    const second = await controller.submit('pub-1', '+972501234567');

    expect(second.status).toBe('success');
    expect(repo.all()).toHaveLength(1);
  });

  it('reactivates a previously revoked follower', async () => {
    const { controller, repo } = makeSut();
    await repo.save(
      Subscriber.create({
        id: 'old',
        publisherId: 'pub-1',
        contactHandle: '+972501234567',
        status: 'revoked',
      }),
    );

    const state = await controller.submit('pub-1', '+972501234567');

    expect(state.status).toBe('success');
    expect(repo.all()).toHaveLength(1);
    expect((await repo.findById('old'))!.isActive()).toBe(true);
  });

  it('errors on a missing publisher id (broken link)', async () => {
    const { controller, repo } = makeSut();

    const state = await controller.submit(null, '+972501234567');

    expect(state.status).toBe('error');
    if (state.status === 'error') expect(state.message).toMatch(/invalid/i);
    expect(repo.all()).toHaveLength(0);
  });

  it('errors on an invalid number without calling subscribe', async () => {
    const { controller, repo } = makeSut();

    const state = await controller.submit('pub-1', 'nope');

    expect(state.status).toBe('error');
    if (state.status === 'error') expect(state.message).toMatch(/valid WhatsApp number/i);
    expect(repo.all()).toHaveLength(0);
  });

  it('surfaces a friendly error when the subscribe use case throws', async () => {
    const repo = new InMemorySubscriberRepository();
    jest.spyOn(repo, 'save').mockRejectedValueOnce(new Error('network down'));
    const controller = new JoinController(new SubscribeUseCase(repo), () => 'id-1');

    const state = await controller.submit('pub-1', '+972501234567');

    expect(state).toEqual({ status: 'error', message: 'network down' });
  });
});
