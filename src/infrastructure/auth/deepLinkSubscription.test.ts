import { subscribeToAuthDeepLinks } from './deepLinkSubscription';
import type { LinkingLike } from './deepLinkSubscription';
import type { AuthUrlCallbacks } from './authUrlHandler';

function makeCallbacks(): { callbacks: AuthUrlCallbacks; setSession: jest.Mock; exchange: jest.Mock } {
  const setSession = jest.fn().mockResolvedValue(undefined);
  const exchange = jest.fn().mockResolvedValue(undefined);
  return {
    callbacks: { setSession, exchangeCodeForSession: exchange },
    setSession,
    exchange,
  };
}

function makeLinking(initialUrl: string | null): {
  linking: LinkingLike;
  emit: (url: string) => void;
  remove: jest.Mock;
} {
  let handler: ((event: { url: string }) => void) | null = null;
  const remove = jest.fn(() => { handler = null; });
  const linking: LinkingLike = {
    getInitialURL: () => Promise.resolve(initialUrl),
    addEventListener: (_type, h) => {
      handler = h;
      return { remove };
    },
  };
  return {
    linking,
    emit: (url: string) => handler?.({ url }),
    remove,
  };
}

describe('subscribeToAuthDeepLinks', () => {
  it('processes the initial URL if the app was opened via a deep link', async () => {
    const { linking } = makeLinking('followme://auth#access_token=acc&refresh_token=ref');
    const { callbacks, setSession } = makeCallbacks();

    subscribeToAuthDeepLinks(linking, callbacks);
    await Promise.resolve();
    await Promise.resolve();

    expect(setSession).toHaveBeenCalledWith('acc', 'ref');
  });

  it('does nothing on mount when there is no initial URL', async () => {
    const { linking } = makeLinking(null);
    const { callbacks, setSession, exchange } = makeCallbacks();

    subscribeToAuthDeepLinks(linking, callbacks);
    await Promise.resolve();
    await Promise.resolve();

    expect(setSession).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('processes URLs received while the app is running', () => {
    const { linking, emit } = makeLinking(null);
    const { callbacks, exchange } = makeCallbacks();

    subscribeToAuthDeepLinks(linking, callbacks);
    emit('followme://auth?code=pkce-code');

    expect(exchange).toHaveBeenCalledWith('pkce-code');
  });

  it('returns an unsubscribe function that removes the underlying listener', () => {
    const { linking, remove } = makeLinking(null);
    const { callbacks } = makeCallbacks();

    const unsubscribe = subscribeToAuthDeepLinks(linking, callbacks);
    expect(remove).not.toHaveBeenCalled();

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('ignores URLs received after unsubscribing', () => {
    const { linking, emit } = makeLinking(null);
    const { callbacks, setSession } = makeCallbacks();

    const unsubscribe = subscribeToAuthDeepLinks(linking, callbacks);
    unsubscribe();
    emit('followme://auth#access_token=acc&refresh_token=ref');

    expect(setSession).not.toHaveBeenCalled();
  });
});
