import type { AuthUrlCallbacks } from './authUrlHandler';
import { handleAuthUrl } from './authUrlHandler';

export interface LinkingSubscription {
  remove(): void;
}

export interface LinkingLike {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: 'url', handler: (event: { url: string }) => void): LinkingSubscription;
}

export function subscribeToAuthDeepLinks(linking: LinkingLike, callbacks: AuthUrlCallbacks): () => void {
  function handleUrl({ url }: { url: string }): void {
    handleAuthUrl(url, callbacks);
  }

  void linking.getInitialURL().then(url => {
    if (url != null) handleUrl({ url });
  });

  const subscription = linking.addEventListener('url', handleUrl);
  return () => subscription.remove();
}
