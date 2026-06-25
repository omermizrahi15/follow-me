import { computeTwilioSignature, verifyTwilioSignature } from './twilioSignature';

// A fixed, independently-reproducible vector (HMAC-SHA1, base64) computed from
// the algorithm Twilio documents. Locks the implementation against regression.
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
  it('produces the documented signature for the known vector', () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(EXPECTED);
  });

  it('is independent of parameter insertion order (params are sorted by name)', () => {
    const reordered = {
      To: '+18005551212',
      From: '+14158675309',
      Caller: '+14158675309',
      Digits: '1234',
    };
    expect(computeTwilioSignature(AUTH_TOKEN, URL, reordered)).toBe(EXPECTED);
  });

  it('changes when the URL changes', () => {
    const other = computeTwilioSignature(AUTH_TOKEN, URL + '&x=1', PARAMS);
    expect(other).not.toBe(EXPECTED);
  });

  it('changes when a parameter value changes', () => {
    const other = computeTwilioSignature(AUTH_TOKEN, URL, { ...PARAMS, Digits: '9999' });
    expect(other).not.toBe(EXPECTED);
  });

  it('changes when the auth token changes', () => {
    expect(computeTwilioSignature('99999', URL, PARAMS)).not.toBe(EXPECTED);
  });
});

describe('verifyTwilioSignature', () => {
  it('accepts a correct signature', () => {
    expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, signature: EXPECTED }),
    ).toBe(true);
  });

  it('rejects a tampered signature', () => {
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: PARAMS,
        signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    ).toBe(false);
  });

  it('rejects a signature computed with the wrong auth token', () => {
    const forged = computeTwilioSignature('wrong-token', URL, PARAMS);
    expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, signature: forged }),
    ).toBe(false);
  });

  it('rejects when params have been tampered with after signing', () => {
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: { ...PARAMS, From: '+10000000000' },
        signature: EXPECTED,
      }),
    ).toBe(false);
  });

  it.each([null, undefined, ''])('rejects a missing signature (%s)', signature => {
    expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, signature }),
    ).toBe(false);
  });
});
