import { computeTwilioSignature, verifyTwilioSignature } from './twilioSignature';

// A fixed, independently-reproducible vector (HMAC-SHA1, base64) computed from
// the algorithm Twilio documents. Locks the implementation against regression —
// including the move from node:crypto to Web Crypto, which has to keep
// producing this exact string for the edge functions to accept real webhooks.
const AUTH_TOKEN = '12345';
const URL = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS = {
  Caller: '+14158675309',
  Digits: '1234',
  From: '+14158675309',
  To: '+18005551212',
};
const EXPECTED = 'V4AdhXOYoGGDl714zmEWoHCrr0A=';

describe('computeTwilioSignature', () => {
  it('produces the documented signature for the known vector', async () => {
    await expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).resolves.toBe(EXPECTED);
  });

  it('is independent of parameter insertion order (params are sorted by name)', async () => {
    const reordered = {
      To: '+18005551212',
      From: '+14158675309',
      Caller: '+14158675309',
      Digits: '1234',
    };
    await expect(computeTwilioSignature(AUTH_TOKEN, URL, reordered)).resolves.toBe(EXPECTED);
  });

  it('changes when the URL changes', async () => {
    await expect(computeTwilioSignature(AUTH_TOKEN, URL + '&x=1', PARAMS)).resolves.not.toBe(EXPECTED);
  });

  it('changes when a parameter value changes', async () => {
    await expect(
      computeTwilioSignature(AUTH_TOKEN, URL, { ...PARAMS, Digits: '9999' }),
    ).resolves.not.toBe(EXPECTED);
  });

  it('changes when the auth token changes', async () => {
    await expect(computeTwilioSignature('99999', URL, PARAMS)).resolves.not.toBe(EXPECTED);
  });
});

describe('verifyTwilioSignature', () => {
  it('accepts a correct signature', async () => {
    await expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, signature: EXPECTED }),
    ).resolves.toBe(true);
  });

  it('rejects a tampered signature', async () => {
    await expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: PARAMS,
        signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a signature computed with the wrong auth token', async () => {
    const forged = await computeTwilioSignature('wrong-token', URL, PARAMS);
    await expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, signature: forged }),
    ).resolves.toBe(false);
  });

  it('rejects when params have been tampered with after signing', async () => {
    await expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: { ...PARAMS, From: '+10000000000' },
        signature: EXPECTED,
      }),
    ).resolves.toBe(false);
  });

  it.each([null, undefined, ''])('rejects a missing signature (%s)', async signature => {
    await expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, signature }),
    ).resolves.toBe(false);
  });
});
