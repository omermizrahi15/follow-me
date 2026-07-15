import { assertEquals } from '@std/assert';
import { approvalPushContent, parseNotifyTime } from './logic.ts';

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
