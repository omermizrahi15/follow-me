import { postNowRequest } from './postNowAction';

const POST_NOW = 'POST_NOW';

describe('postNowRequest', () => {
  it('publishes the batch the push names', () => {
    expect(
      postNowRequest({ actionIdentifier: POST_NOW, data: { batchId: 'batch-1' } }, POST_NOW),
    ).toEqual({ kind: 'publish', batchId: 'batch-1' });
  });

  it('ignores anything that is not the Post now button', () => {
    // Tapping the notification body opens the review screen — the navigator's job.
    expect(
      postNowRequest({ actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', data: { batchId: 'b' } }, POST_NOW),
    ).toEqual({ kind: 'ignore' });
    expect(postNowRequest({ actionIdentifier: 'REVIEW', data: { batchId: 'b' } }, POST_NOW)).toEqual({ kind: 'ignore' });
    expect(postNowRequest(null, POST_NOW)).toEqual({ kind: 'ignore' });
  });

  it('asks for the app when there is no server batch to publish', () => {
    // The locally scheduled reminder: its photos only exist on the device, so
    // the background path has nothing to send.
    expect(postNowRequest({ actionIdentifier: POST_NOW, data: { screen: 'ReviewSuggestion' } as never }, POST_NOW))
      .toEqual({ kind: 'needs-app' });
    expect(postNowRequest({ actionIdentifier: POST_NOW, data: undefined }, POST_NOW)).toEqual({ kind: 'needs-app' });
  });

  it('does not trust a malformed batchId', () => {
    for (const batchId of ['', 42, null, {}, ['batch-1']]) {
      expect(postNowRequest({ actionIdentifier: POST_NOW, data: { batchId } }, POST_NOW))
        .toEqual({ kind: 'needs-app' });
    }
  });
});
