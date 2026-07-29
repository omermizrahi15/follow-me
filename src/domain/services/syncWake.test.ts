import { isSyncWakePayload, SYNC_WAKE_TYPE } from './syncWake';

describe('isSyncWakePayload', () => {
  it('matches the marker at every nesting the platforms use', () => {
    // The Expo `data` object itself (foreground listener).
    expect(isSyncWakePayload({ type: SYNC_WAKE_TYPE })).toBe(true);
    // iOS background task: data nested under `body`.
    expect(isSyncWakePayload({ body: { type: SYNC_WAKE_TYPE } })).toBe(true);
    expect(isSyncWakePayload({ body: { data: { type: SYNC_WAKE_TYPE } } })).toBe(true);
    // Android background task.
    expect(isSyncWakePayload({ notification: { data: { type: SYNC_WAKE_TYPE } } })).toBe(true);
  });

  it('ignores the rich approval push, which fires the same task', () => {
    // The approval batch push is also a remote notification; acting on it would
    // kick off a full library sync every time a batch is delivered.
    expect(
      isSyncWakePayload({ body: { screen: 'ReviewSuggestion', batchId: 'abc', gallery: [] } }),
    ).toBe(false);
  });

  it('is not fooled by a lookalike value in the wrong place', () => {
    expect(isSyncWakePayload({ body: { screen: SYNC_WAKE_TYPE } })).toBe(false);
    expect(isSyncWakePayload({ type: 'sync-candidates-v2' })).toBe(false);
  });

  it('survives junk payloads without throwing', () => {
    for (const junk of [null, undefined, '', 0, [], { body: null }, { body: 'text' }]) {
      expect(isSyncWakePayload(junk)).toBe(false);
    }
  });
});
