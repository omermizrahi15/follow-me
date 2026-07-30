import { assertEquals } from '@std/assert';
import {
  approvalPushContent,
  CLIENT_STALE_MS,
  parseNotifyTime,
  reminderPushContent,
  SYNC_GRACE_MS,
  syncGraceDecision,
  WAKE_PUSH_INTERVAL_MS,
} from './logic.ts';

Deno.test('parseNotifyTime — splits HH:MM', () => {
  assertEquals(parseNotifyTime('09:30'), { hour: 9, minute: 30 });
  assertEquals(parseNotifyTime('7'), { hour: 7, minute: 0 }); // no minute
  assertEquals(parseNotifyTime(''), { hour: 0, minute: 0 });
});

Deno.test('approvalPushContent — pluralises the count', () => {
  assertEquals(approvalPushContent([], 1).title, '1 photo ready to post 📸');
  assertEquals(approvalPushContent([], 3).title, '3 photos ready to post 📸');
});

Deno.test('approvalPushContent — previews the first 3 captions (blanks dropped, not backfilled)', () => {
  // slice(0,3) happens before filter: ['Sunset','','Street food'] → two shown.
  assertEquals(
    approvalPushContent(['Sunset', '', 'Street food', 'Mountain view', 'Extra'], 5).body,
    'Sunset · Street food',
  );
  // Three non-blank captions in the first 3 slots all show.
  assertEquals(
    approvalPushContent(['Sunset', 'Street food', 'Mountain view', 'Extra'], 4).body,
    'Sunset · Street food · Mountain view',
  );
});

Deno.test('approvalPushContent — generic body when there are no captions', () => {
  assertEquals(approvalPushContent(['', ''], 2).body, 'Your AI-selected photos are ready to review.');
});

Deno.test('approvalPushContent — adds the location to the title when given', () => {
  assertEquals(approvalPushContent([], 3, 'Tel Aviv').title, '3 photos from Tel Aviv ready to post 📸');
  assertEquals(approvalPushContent([], 1, ' Paris ').title, '1 photo from Paris ready to post 📸');
});

Deno.test('approvalPushContent — omits location for empty/blank/absent place', () => {
  assertEquals(approvalPushContent([], 3).title, '3 photos ready to post 📸');
  assertEquals(approvalPushContent([], 3, '').title, '3 photos ready to post 📸');
  assertEquals(approvalPushContent([], 3, '   ').title, '3 photos ready to post 📸');
  assertEquals(approvalPushContent([], 3, null).title, '3 photos ready to post 📸');
});

Deno.test('reminderPushContent — distinct copy per fallback reason', () => {
  assertEquals(
    reminderPushContent('stale-client').body,
    'Open Follow Me so your recent photos can upload — your next post is picked from them.',
  );
  assertEquals(
    reminderPushContent('no-candidates').body,
    'No new photos since your last post — take a few, or open the app to pick older ones.',
  );
  assertEquals(
    reminderPushContent('empty-batch').body,
    'None of your recent photos fit your filters — tap to choose some yourself.',
  );
});

Deno.test('reminderPushContent — never reuses the "batch is ready" framing (issue #97)', () => {
  // The bug was a fallback push indistinguishable from the real post
  // notification. No fallback title may promise photos.
  for (const reason of ['no-candidates', 'empty-batch', 'stale-client'] as const) {
    const { title } = reminderPushContent(reason);
    assertEquals(title.includes('ready to post'), false, `"${title}" reads like a real batch push`);
    assertEquals(title.includes('📸'), false, `"${title}" reads like a real batch push`);
  }
});

// --- syncGraceDecision (issue #97) ------------------------------------------

const NOW = new Date('2026-07-29T12:30:00Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

const grace = (over: Partial<Parameters<typeof syncGraceDecision>[0]> = {}) =>
  syncGraceDecision({
    pendingSince: null,
    lastWakePushAt: null,
    lastClientSyncAt: null,
    now: NOW,
    ...over,
  });

Deno.test('syncGraceDecision — first empty tick waits and wakes the device', () => {
  // The user must never see a fallback on the first sighting: this is exactly
  // the moment issue #97 fired a contentless push.
  assertEquals(grace(), { kind: 'wait', nudge: true });
});

Deno.test('syncGraceDecision — keeps waiting inside the grace window', () => {
  assertEquals(grace({ pendingSince: ago(SYNC_GRACE_MS - 1000) }).kind, 'wait');
});

Deno.test('syncGraceDecision — throttles the wake push', () => {
  const pendingSince = ago(2 * 60 * 60 * 1000);
  // Just nudged — stay quiet.
  assertEquals(grace({ pendingSince, lastWakePushAt: ago(WAKE_PUSH_INTERVAL_MS - 1000) }), {
    kind: 'wait',
    nudge: false,
  });
  // Interval elapsed — nudge again.
  assertEquals(grace({ pendingSince, lastWakePushAt: ago(WAKE_PUSH_INTERVAL_MS) }), {
    kind: 'wait',
    nudge: true,
  });
});

Deno.test('syncGraceDecision — gives up once the grace window expires', () => {
  assertEquals(grace({ pendingSince: ago(SYNC_GRACE_MS) }), {
    kind: 'give-up',
    reason: 'stale-client',
  });
});

Deno.test('syncGraceDecision — blames the phone only when it has not checked in', () => {
  const expired = ago(SYNC_GRACE_MS);
  // Heartbeat is fresh: the app is syncing fine, there is genuinely nothing new.
  assertEquals(grace({ pendingSince: expired, lastClientSyncAt: ago(60 * 60 * 1000) }).kind, 'give-up');
  assertEquals(
    grace({ pendingSince: expired, lastClientSyncAt: ago(60 * 60 * 1000) }),
    { kind: 'give-up', reason: 'no-candidates' },
  );
  // Heartbeat is stale: we cannot claim there are no photos — ask them to open the app.
  assertEquals(grace({ pendingSince: expired, lastClientSyncAt: ago(CLIENT_STALE_MS) }), {
    kind: 'give-up',
    reason: 'stale-client',
  });
});
