import { DEFAULT_SITE_URL, siteUrls } from './siteUrls';

describe('siteUrls', () => {
  it('builds every public page from one base', () => {
    const u = siteUrls('https://example.com/follow-me');
    expect(u.privacy).toBe('https://example.com/follow-me/privacy/');
    expect(u.terms).toBe('https://example.com/follow-me/terms/');
    expect(u.join).toBe('https://example.com/follow-me/join/');
    expect(u.gallery).toBe('https://example.com/follow-me/gallery.html');
  });

  it('tolerates trailing slashes and whitespace on the base', () => {
    expect(siteUrls(' https://example.com/// ').join).toBe('https://example.com/join/');
  });

  it('falls back to the default site when the base is missing or blank', () => {
    expect(siteUrls(undefined).join).toBe(`${DEFAULT_SITE_URL}/join/`);
    expect(siteUrls('  ').privacy).toBe(`${DEFAULT_SITE_URL}/privacy/`);
  });

  it('rejects a non-https base rather than shipping insecure links', () => {
    expect(siteUrls('http://example.com').join).toBe(`${DEFAULT_SITE_URL}/join/`);
  });
});
