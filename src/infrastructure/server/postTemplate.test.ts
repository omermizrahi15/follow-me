/**
 * Tests for the WhatsApp post-template selector used by send-post / auto-post
 * (issue #24). Variable ordering here is asserted against the templates
 * registered in Twilio — if the templates are re-cut, these must move together.
 */
import { composeReplyLink } from '../../domain/services/notificationBody';
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
        '6': 'https://wa.me/972527712556?text=Re%3A%20your%20photos%20from%20Tel%20Aviv%2C%20Israel%20%E2%9C%A8',
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
      '5': 'https://wa.me/972527712556?text=Re%3A%20your%20latest%20photos%20%E2%9C%A8',
      '6': 'https://cdn/collage.jpg',
    });
  });

  it('falls back to the no-location template when the location SID is not configured', () => {
    const t = buildPostTemplate({ postSid: 'HXpost' }, { ...BASE, place: 'Lisbon' });
    expect(t?.contentSid).toBe('HXpost');
  });

  it('strips the leading + from the reply number', () => {
    const t = buildPostTemplate(ENV, { ...BASE, place: null });
    expect(t?.variables['5']).toMatch(/^https:\/\/wa\.me\/972527712556\?/);
  });

  // Issue #143: WhatsApp has no deep link that opens a quoted reply to a
  // specific message, so the link pre-fills which post it answers instead.
  describe('reply link (issue #143)', () => {
    it('pre-fills the place in the reply subject', () => {
      const t = buildPostTemplate(ENV, { ...BASE, place: 'Tel Aviv, Israel' });
      expect(decodeURIComponent(t?.variables['6'] ?? '')).toContain('Re: your photos from Tel Aviv, Israel ✨');
    });

    it('falls back to "your latest photos" when the post has no place', () => {
      const t = buildPostTemplate(ENV, { ...BASE, place: null });
      expect(decodeURIComponent(t?.variables['5'] ?? '')).toContain('Re: your latest photos ✨');
    });

    it('still names the place when the location template is not configured', () => {
      const t = buildPostTemplate({ postSid: 'HXpost' }, { ...BASE, place: 'Lisbon' });
      expect(decodeURIComponent(t?.variables['5'] ?? '')).toContain('Re: your photos from Lisbon ✨');
    });

    // postTemplate.ts must stay import-free (it is loaded by Deno with .ts
    // extensions AND by jest without), so the builder is duplicated there.
    // This pins the copy to the original.
    it.each([
      ['Tel Aviv, Israel'],
      [null],
      ['  Porto\n\tCity  '],
    ])('matches composeReplyLink for place %p', place => {
      const t = buildPostTemplate(ENV, { ...BASE, place });
      const variable = place != null && place.trim() !== '' ? '6' : '5';
      expect(t?.variables[variable]).toBe(composeReplyLink(BASE.publisherPhone, place));
    });

    it('percent-encodes the subject, so the value carries no whitespace WhatsApp would reject', () => {
      const t = buildPostTemplate(ENV, { ...BASE, place: 'Tel Aviv, Israel' });
      expect(t?.variables['6']).not.toMatch(/\s/);
    });
  });

  // Issue #220: a template body is fixed, so a caption needs its own pair of
  // templates with an extra variable. The caption-less pair stays as it was.
  describe('caption (issue #220)', () => {
    const CAPTION_ENV = {
      ...ENV,
      postCaptionSid: 'HXpostCap',
      postLocationCaptionSid: 'HXpostLocCap',
    };

    it('uses the location+caption template, caption right after the place', () => {
      const t = buildPostTemplate(CAPTION_ENV, { ...BASE, place: 'Lisbon', caption: 'Pastel de nata ✨' });
      expect(t?.contentSid).toBe('HXpostLocCap');
      expect(t?.variables).toEqual({
        '1': 'Uri Shiber',
        '2': 'Lisbon',
        '3': 'Pastel de nata ✨',
        '4': '2',
        '5': 'https://pages.dev/gallery.html?id=abc',
        '6': 'Uri Shiber',
        '7': composeReplyLink(BASE.publisherPhone, 'Lisbon'),
        '8': 'https://cdn/collage.jpg',
      });
    });

    it('uses the no-place caption template when the post has no place', () => {
      const t = buildPostTemplate(CAPTION_ENV, { ...BASE, place: null, caption: 'Pastel de nata ✨' });
      expect(t?.contentSid).toBe('HXpostCap');
      expect(t?.variables).toEqual({
        '1': 'Uri Shiber',
        '2': 'Pastel de nata ✨',
        '3': '2',
        '4': 'https://pages.dev/gallery.html?id=abc',
        '5': 'Uri Shiber',
        '6': composeReplyLink(BASE.publisherPhone, null),
        '7': 'https://cdn/collage.jpg',
      });
    });

    it('flattens line breaks in the caption (WhatsApp rejects them in variables)', () => {
      const t = buildPostTemplate(CAPTION_ENV, { ...BASE, place: null, caption: 'Day one\n\nDay   two' });
      expect(t?.variables['2']).toBe('Day one Day two');
    });

    it('uses the caption-less templates when there is no caption', () => {
      expect(buildPostTemplate(CAPTION_ENV, { ...BASE, place: 'Lisbon' })?.contentSid).toBe('HXpostLoc');
      expect(buildPostTemplate(CAPTION_ENV, { ...BASE, place: null, caption: null })?.contentSid).toBe('HXpost');
      expect(buildPostTemplate(CAPTION_ENV, { ...BASE, place: null, caption: '  \n ' })?.contentSid).toBe('HXpost');
    });

    it('degrades to the caption-less template when the caption SIDs are not configured', () => {
      const t = buildPostTemplate(ENV, { ...BASE, place: 'Lisbon', caption: 'Pastel de nata ✨' });
      expect(t?.contentSid).toBe('HXpostLoc');
      expect(Object.keys(t?.variables ?? {})).toHaveLength(7);
    });

    it('falls back to the no-place caption template when only that SID is configured', () => {
      const t = buildPostTemplate(
        { postSid: 'HXpost', postCaptionSid: 'HXpostCap' },
        { ...BASE, place: 'Lisbon', caption: 'Hi' },
      );
      expect(t?.contentSid).toBe('HXpostCap');
      expect(t?.variables['2']).toBe('Hi');
    });
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
