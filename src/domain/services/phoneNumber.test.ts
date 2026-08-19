import { callingCodeOf, toE164 } from './phoneNumber';

describe('callingCodeOf', () => {
  it('reads a three-digit calling code off an E.164 number', () => {
    expect(callingCodeOf('+972501234567')).toBe('972');
  });

  it('reads one- and two-digit codes', () => {
    expect(callingCodeOf('+15551234567')).toBe('1');
    expect(callingCodeOf('+447700900123')).toBe('44');
  });

  it('ignores formatting', () => {
    expect(callingCodeOf('+44 7700 900123')).toBe('44');
  });

  it('returns null for a national number or a missing one', () => {
    expect(callingCodeOf('0501234567')).toBeNull();
    expect(callingCodeOf(null)).toBeNull();
    expect(callingCodeOf('')).toBeNull();
  });
});

describe('toE164', () => {
  it('strips formatting from an already-international number', () => {
    expect(toE164('+972 50-123 4567', '972')).toBe('+972501234567');
    expect(toE164('+1 (555) 123-4567', '1')).toBe('+15551234567');
  });

  it('treats a 00 prefix as +', () => {
    expect(toE164('00972501234567', '972')).toBe('+972501234567');
    expect(toE164('00 972 50 123 4567', '1')).toBe('+972501234567');
  });

  it('expands a national number using the publisher calling code', () => {
    expect(toE164('050-123 4567', '972')).toBe('+972501234567');
    expect(toE164('(555) 123-4567', '1')).toBe('+15551234567');
  });

  it('drops only the trunk zero, never a second digit', () => {
    expect(toE164('021234567', '972')).toBe('+97221234567');
  });

  it('accepts an international number written without + or 00', () => {
    expect(toE164('972501234567', '972')).toBe('+972501234567');
  });

  it('prefixes a local number that merely starts with the country digits', () => {
    // 44 is the UK code, but 4477... here is a nine-digit local number.
    expect(toE164('447700900', '44')).toBe('+44447700900');
  });

  it('returns null for a national number when the publisher region is unknown', () => {
    expect(toE164('050-123 4567', null)).toBeNull();
  });

  it('still resolves an international number when the region is unknown', () => {
    expect(toE164('+972501234567', null)).toBe('+972501234567');
    expect(toE164('00972501234567', null)).toBe('+972501234567');
  });

  it('rejects short codes, empty input, and absent values', () => {
    expect(toE164('4567', '972')).toBeNull();
    expect(toE164('*123#', '972')).toBeNull();
    expect(toE164('', '972')).toBeNull();
    expect(toE164(null, '972')).toBeNull();
    expect(toE164(undefined, '972')).toBeNull();
  });

  it('rejects numbers longer than E.164 allows', () => {
    expect(toE164('+9725012345678901', '972')).toBeNull();
  });

  it('ignores an alphabetic tail', () => {
    expect(toE164('+972 50 123 4567 ext', '972')).toBe('+972501234567');
  });

  it('normalises the two spellings of one number to the same key', () => {
    expect(toE164('050 123 4567', '972')).toBe(toE164('+972-50-123-4567', '972'));
  });
});
