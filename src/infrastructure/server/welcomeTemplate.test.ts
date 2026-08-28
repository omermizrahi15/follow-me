/**
 * Tests for the new-follower welcome template used by `subscribe` (issue #164).
 *
 * REGISTERED_BODY below is the body of `follow_me_subscriber_welcome_v2` as it
 * is submitted to Twilio, copied verbatim. It is asserted against
 * `composeWelcomeMessage` so the template and the free-form fallback can never
 * drift: a follower reads the same words whichever path delivered them.
 * Changing the copy means re-cutting the template and another round of Meta
 * approval — change both together.
 *
 * v2 adds {{2}}, the publisher's feed URL, so the welcome hands the follower
 * every post and not just the promise of future ones. The link is a *variable*
 * rather than body text on purpose (it differs per publisher, and a later move
 * to a custom domain then costs no re-approval), and it deliberately sits on
 * the second-to-last line — Meta rejects a body whose final token is a
 * parameter.
 */
import { composeWelcomeMessage } from '../../domain/services/optOutMessages';
import { buildWelcomeTemplate } from '../../../supabase/functions/_shared/welcomeTemplate';

const ENV = { welcomeSid: 'HXwelcome' };
const FEED = 'https://omermizrahi15.github.io/follow-me/gallery.html?u=pub-1';
const INPUT = { publisherName: 'Uri Shiber', galleryUrl: FEED };

const REGISTERED_BODY =
  "You're now following {{1}}.\n" +
  "You'll receive their photos here on WhatsApp.\n" +
  'All their posts in one place: {{2}}\n' +
  'Reply STOP at any time to unsubscribe.';

function render(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => variables[index] ?? '');
}

describe('buildWelcomeTemplate', () => {
  it('fills the name and feed-link variables', () => {
    expect(buildWelcomeTemplate(ENV, INPUT)).toEqual({
      contentSid: 'HXwelcome',
      variables: { '1': 'Uri Shiber', '2': FEED },
    });
  });

  it('renders the registered template to exactly the free-form welcome copy', () => {
    const t = buildWelcomeTemplate(ENV, INPUT);
    const rendered = render(REGISTERED_BODY, t?.variables ?? {}).replace(/[ \t]+$/gm, '');
    expect(rendered).toBe(composeWelcomeMessage('Uri Shiber', FEED));
  });

  it('keeps the copy on four lines, as the template lays it out', () => {
    expect(composeWelcomeMessage('Uri Shiber', FEED).split('\n')).toHaveLength(4);
  });

  it('never ends the body on a variable, which Meta rejects', () => {
    expect(REGISTERED_BODY.trimEnd().endsWith('}}')).toBe(false);
  });

  it('returns null (→ free-form fallback) when the SID is not configured', () => {
    expect(buildWelcomeTemplate({}, INPUT)).toBeNull();
  });

  it('returns null on a blank name rather than sending a template with a hole in it', () => {
    expect(buildWelcomeTemplate(ENV, { ...INPUT, publisherName: '  ' })).toBeNull();
  });

  it('returns null on a missing feed link rather than leaving the second slot empty', () => {
    expect(buildWelcomeTemplate(ENV, { ...INPUT, galleryUrl: '' })).toBeNull();
  });

  it('collapses whitespace in the name (WhatsApp rejects newlines/tabs in variables)', () => {
    const t = buildWelcomeTemplate(ENV, { ...INPUT, publisherName: 'Uri\n\tShiber' });
    expect(t?.variables['1']).toBe('Uri Shiber');
  });
});
