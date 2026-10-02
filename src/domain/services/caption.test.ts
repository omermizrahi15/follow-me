import { MAX_CAPTION_LENGTH, captionForTemplate, normalizeCaption } from './caption';

describe('normalizeCaption', () => {
  it('returns null for nothing, empty or whitespace-only input', () => {
    expect(normalizeCaption(undefined)).toBeNull();
    expect(normalizeCaption(null)).toBeNull();
    expect(normalizeCaption('')).toBeNull();
    expect(normalizeCaption('  \n\t ')).toBeNull();
  });

  it('trims the ends', () => {
    expect(normalizeCaption('  Made it to the top 🏔️  ')).toBe('Made it to the top 🏔️');
  });

  it('keeps single line breaks but squashes runs of blank lines', () => {
    expect(normalizeCaption('Day one\nDay two')).toBe('Day one\nDay two');
    expect(normalizeCaption('Day one\n\n\n\nDay two')).toBe('Day one\n\nDay two');
  });

  it('normalises Windows line endings', () => {
    expect(normalizeCaption('a\r\nb')).toBe('a\nb');
  });

  it('caps the length, without leaving trailing whitespace', () => {
    const long = `${'x'.repeat(MAX_CAPTION_LENGTH - 1)} ${'y'.repeat(50)}`;
    const out = normalizeCaption(long);
    expect(out).not.toBeNull();
    expect((out as string).length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
    expect(out).toBe((out as string).trim());
  });

  it('does not split an emoji surrogate pair when capping', () => {
    const out = normalizeCaption('a'.repeat(MAX_CAPTION_LENGTH - 1) + '😀😀') as string;
    expect(out.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
    // A lone high surrogate would make the string invalid UTF-16.
    expect(out).toBe(Buffer.from(out, 'utf16le').toString('utf16le'));
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
  });

  it('ignores non-string input', () => {
    expect(normalizeCaption(42 as unknown as string)).toBeNull();
  });
});

describe('captionForTemplate', () => {
  it('collapses newlines, tabs and space runs to single spaces (WhatsApp variable rule)', () => {
    expect(captionForTemplate('Day one\n\nDay   two\tdone')).toBe('Day one Day two done');
  });
});
