/**
 * Tests for the WhatsApp post-template selector used by send-post / auto-post
 * (issue #24). Variable ordering here is asserted against the templates
 * registered in Twilio — if the templates are re-cut, these must move together.
 */
import { buildPostTemplate } from '../../../supabase/functions/_shared/postTemplate';

const ENV = { postSid: 'HXpost', postLocationSid: 'HXpostLoc' };
const BASE = {
  publisherName: 'Uri Shiber',
  publisherPhone: '+972527712556',
  photoCount: 2,
  galleryUrl: 'https://pages.dev/gallery.html?id=abc',
  mediaUrl: 'https://cdn/collage.jpg',
};

describe('buildPostTemplate', () => {
  it('uses the location template and fills variables in order when a place is present', () => {
    const t = buildPostTemplate(ENV, { ...BASE, place: 'Tel Aviv, Israel' });
    expect(t).toEqual({
      contentSid: 'HXpostLoc',
      variables: {
        '1': 'Uri Shiber',
        '2': 'Tel Aviv, Israel',
        '3': '2',
        '4': 'https://pages.dev/gallery.html?id=abc',
        '5': 'Uri Shiber',
        '6': 'https://wa.me/972527712556',
        '7': 'https://cdn/collage.jpg',
      },
    });
  });

  it('uses the no-location template when there is no place', () => {
    const t = buildPostTemplate(ENV, { ...BASE, place: null });
    expect(t?.contentSid).toBe('HXpost');
    expect(t?.variables).toEqual({
      '1': 'Uri Shiber',
      '2': '2',
      '3': 'https://pages.dev/gallery.html?id=abc',
      '4': 'Uri Shiber',
      '5': 'https://wa.me/972527712556',
      '6': 'https://cdn/collage.jpg',
    });
  });

  it('falls back to the no-location template when the location SID is not configured', () => {
    const t = buildPostTemplate({ postSid: 'HXpost' }, { ...BASE, place: 'Lisbon' });
    expect(t?.contentSid).toBe('HXpost');
  });

  it('strips the leading + from the reply number', () => {
    const t = buildPostTemplate(ENV, { ...BASE, place: null });
    expect(t?.variables['5']).toBe('https://wa.me/972527712556');
  });

  it('returns null (→ free-form fallback) when no template SIDs are configured', () => {
    expect(buildPostTemplate({}, { ...BASE, place: 'Tel Aviv' })).toBeNull();
  });

  it('returns null when the gallery link, media, or phone is missing', () => {
    const noPhone = {
      publisherName: BASE.publisherName,
      photoCount: BASE.photoCount,
      galleryUrl: BASE.galleryUrl,
      mediaUrl: BASE.mediaUrl,
      place: null,
    };
    expect(buildPostTemplate(ENV, { ...BASE, galleryUrl: null, place: null })).toBeNull();
    expect(buildPostTemplate(ENV, { ...BASE, mediaUrl: null, place: null })).toBeNull();
    expect(buildPostTemplate(ENV, noPhone)).toBeNull();
  });

  it('collapses whitespace in variable values (WhatsApp rejects newlines/tabs)', () => {
    const t = buildPostTemplate(ENV, { ...BASE, publisherName: 'Uri\n\tShiber', place: 'Tel  Aviv' });
    expect(t?.variables['1']).toBe('Uri Shiber');
    expect(t?.variables['2']).toBe('Tel Aviv');
  });
});
