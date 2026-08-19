/**
 * Phone numbers, normalised to E.164 so two spellings of the same number
 * compare equal.
 *
 * Subscriber handles are already bare E.164 (`+972501234567`), but address-book
 * numbers are stored in every imaginable format — `050-123 4567`, `(050) 1234567`,
 * `00972 50 123 4567`, `+972 50-123-4567`. Matching one against the other with a
 * string compare finds almost nothing, so both sides go through `toE164` first.
 *
 * This is deliberately a small, dependency-free normaliser rather than a full
 * libphonenumber port: it only has to decide "is this the same number", not
 * validate national numbering plans or format for display.
 */

/**
 * ITU-T E.164 country calling codes. The set is prefix-free by design — no code
 * is a prefix of another — so the shortest match at the front of a number is
 * always the right one, and `callingCodeOf` can scan 1→3 digits and stop.
 */
const CALLING_CODES: ReadonlySet<string> = new Set([
  // North America / Russia & Kazakhstan
  '1', '7',
  // Two-digit codes
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44',
  '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58',
  '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91',
  '92', '93', '94', '95', '98',
  // Africa
  '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225',
  '226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236',
  '237', '238', '239', '240', '241', '242', '243', '244', '245', '246', '247',
  '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258',
  '260', '261', '262', '263', '264', '265', '266', '267', '268', '269', '290',
  '291', '297', '298', '299',
  // Europe
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370',
  '371', '372', '373', '374', '375', '376', '377', '378', '379', '380', '381',
  '382', '383', '385', '386', '387', '389', '420', '421', '423',
  // Americas
  '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590',
  '591', '592', '593', '594', '595', '596', '597', '598', '599',
  // Oceania & South-East Asia
  '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681',
  '682', '683', '685', '686', '687', '688', '689', '690', '691', '692',
  // Global services & East Asia
  '800', '808', '850', '852', '853', '855', '856', '870', '878', '880', '881',
  '882', '883', '886', '888',
  // Middle East & Central Asia
  '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971',
  '972', '973', '974', '975', '976', '977', '979', '991', '992', '993', '994',
  '995', '996', '998',
]);

/** E.164 caps the whole number (calling code included) at 15 digits. */
const MAX_DIGITS = 15;
/** Shorter than this and it is an extension or a short code, not a real number. */
const MIN_DIGITS = 8;
/**
 * The shortest national number we will believe is hiding behind a country code
 * in a number written without '+'. Eight covers all but a handful of numbering
 * plans (Iceland's seven-digit numbers being the notable miss, where the entry
 * simply stays unmatched).
 */
const NATIONAL_MIN_DIGITS = 8;

/**
 * The calling code a number starts with — `'972'` for `+972501234567` — or null
 * when it starts with none we know. Used to read the publisher's own region off
 * their sign-in number, which is the default country for un-prefixed
 * address-book entries.
 */
export function callingCodeOf(phone: string | null | undefined): string | null {
  if (phone == null) return null;
  const digits = digitsOf(phone);
  for (let length = 1; length <= 3; length++) {
    const candidate = digits.slice(0, length);
    if (candidate.length === length && CALLING_CODES.has(candidate)) return candidate;
  }
  return null;
}

/**
 * `raw` as a bare E.164 string (`+972501234567`), or null when it can't be
 * resolved to one — in which case the caller shows the number as it came.
 *
 * `defaultCallingCode` is the publisher's own calling code, applied to numbers
 * written in national form. Without it a national number is genuinely ambiguous
 * (`0501234567` is a different person in every country), so we return null
 * rather than guess.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCallingCode: string | null,
): string | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  // A leading '+' is the only formatting character that carries meaning; strip
  // everything else (spaces, dashes, dots, brackets, and the alphabetic tail of
  // "555-1234 ext 9" alike).
  const explicitlyInternational = trimmed.startsWith('+');
  let digits = digitsOf(trimmed);

  if (!explicitlyInternational && digits.startsWith('00')) {
    // '00' is the international access prefix in most of the world — the same
    // intent as '+'.
    digits = digits.slice(2);
    return international(digits);
  }
  if (explicitlyInternational) return international(digits);

  if (defaultCallingCode == null) return null;

  if (digits.startsWith('0')) {
    // National form with a trunk prefix: drop the single leading 0 and prepend
    // the country. (Only one — '00' was already handled above.)
    return international(defaultCallingCode + digits.slice(1));
  }
  if (digits.length - defaultCallingCode.length >= NATIONAL_MIN_DIGITS
      && digits.startsWith(defaultCallingCode)) {
    // Already international, just written without '+' or '00'. The length guard
    // keeps a local number that happens to begin with the country's own digits
    // from being decapitated: what is left after removing the code has to be a
    // plausible national number in its own right. Where the two readings are
    // both plausible this prefers the wrong-but-harmless one — an over-long key
    // matches no subscriber and the row falls back to the number, whereas a
    // wrongly truncated number could match the *wrong* follower.
    return international(digits);
  }
  return international(defaultCallingCode + digits);
}

/** Digits only — everything else, including a leading '+', is dropped. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Accepts a digit string as a full international number. Unknown calling codes
 * pass through: the goal is a stable key for comparing two numbers, and being
 * strict here would only drop matches for countries missing from the table.
 */
function international(digits: string): string | null {
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  if (digits.startsWith('0')) return null;
  return `+${digits}`;
}
