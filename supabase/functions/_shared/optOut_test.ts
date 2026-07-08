import { assert, assertEquals } from '@std/assert';
import {
  composeResubscribeConfirmation,
  composeUnsubscribeConfirmation,
  computeTwilioSignature,
  parseInboundCommand,
  verifyTwilioSignature,
} from './optOut.ts';

Deno.test('parseInboundCommand — STOP keywords (case/space insensitive)', () => {
  for (const kw of ['STOP', 'stop', '  Stop ', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
    assertEquals(parseInboundCommand(kw).kind, 'stop', kw);
  }
});

Deno.test('parseInboundCommand — START keywords', () => {
  for (const kw of ['START', 'yes', 'SUBSCRIBE', 'unstop']) {
    assertEquals(parseInboundCommand(kw).kind, 'start', kw);
  }
});

Deno.test('parseInboundCommand — JOIN carries the publisher id', () => {
  const r = parseInboundCommand('JOIN pub_123');
  assertEquals(r.kind, 'join');
  if (r.kind === 'join') assertEquals(r.publisherId, 'pub_123');
});

Deno.test('parseInboundCommand — empty / free text is unknown', () => {
  assertEquals(parseInboundCommand('').kind, 'unknown');
  assertEquals(parseInboundCommand('hey what is this').kind, 'unknown');
});

Deno.test('confirmation messages name the publisher', () => {
  assert(composeUnsubscribeConfirmation('Uri').includes('Uri'));
  assert(composeResubscribeConfirmation('Uri').includes('Uri'));
});

Deno.test('twilio signature round-trips and rejects tampering', async () => {
  const authToken = 'test-token', url = 'https://ex.com/webhook';
  const params = { B: '2', A: '1' };
  const sig = await computeTwilioSignature(authToken, url, params);
  assert(await verifyTwilioSignature({ authToken, url, params, signature: sig }));
  assert(!(await verifyTwilioSignature({ authToken, url, params, signature: 'tampered' })));
  assert(!(await verifyTwilioSignature({ authToken, url, params, signature: null })));
});
