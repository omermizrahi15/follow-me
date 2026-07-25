import { assertEquals } from '@std/assert';
import { approvalPushContent, dominantPlace, parseNotifyTime, reminderPushContent } from './logic.ts';

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

Deno.test('dominantPlace — most frequent non-empty place, ties by first appearance', () => {
  assertEquals(dominantPlace(['Tel Aviv', 'Paris', 'Tel Aviv']), 'Tel Aviv');
  // Tie (1 each): first-seen wins because it reaches the top count first.
  assertEquals(dominantPlace(['Paris', 'Tel Aviv']), 'Paris');
  assertEquals(dominantPlace([' Rome ', 'Rome']), 'Rome'); // trimmed + merged
});

Deno.test('dominantPlace — empty string when no photo has a place', () => {
  assertEquals(dominantPlace([]), '');
  assertEquals(dominantPlace(['', '  ', '']), '');
});

Deno.test('reminderPushContent — distinct copy per fallback reason', () => {
  const noCandidates = reminderPushContent('no-candidates');
  const emptyBatch = reminderPushContent('empty-batch');
  assertEquals(noCandidates.title, 'Ready for your next post?');
  assertEquals(emptyBatch.title, 'Ready for your next post?');
  assertEquals(noCandidates.body, 'No recent photos have synced yet — open the app to upload some.');
  assertEquals(emptyBatch.body, "None of your recent photos fit your filters — tap to choose some yourself.");
});
