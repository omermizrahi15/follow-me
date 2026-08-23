/**
 * Tests for the new-follower welcome template used by `subscribe` (issue #164).
 *
 * REGISTERED_BODY below is the body of `follow_me_subscriber_welcome` as it
 * actually exists in the Twilio account (Content `HX8145066c…`), copied
 * verbatim. It is asserted against `composeWelcomeMessage` so the template and
 * the free-form fallback can never drift: a follower reads the same words
 * whichever path delivered them. Changing the copy means re-cutting the
 * template and another round of Meta approval — change both together.
 */
import { composeWelcomeMessage } from '../../domain/services/optOutMessages';
import { buildWelcomeTemplate } from '../../../supabase/functions/_shared/welcomeTemplate';

const ENV = { welcomeSid: 'HXwelcome' };

// The ` ` escapes are real trailing spaces in the registered draft, before
// each line break. WhatsApp renders them identically to none, and re-cutting
// the template to tidy invisible whitespace would cost a new SID and another
// approval round — so the source copy stays clean and the comparison below
// trims them instead.
const REGISTERED_BODY =
  "You're now following {{1}}. \n" +
  "You'll receive their photos here on WhatsApp. \n" +
  'Reply STOP at any time to unsubscribe.';

function render(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => variables[index] ?? '');
}

describe('buildWelcomeTemplate', () => {
  it('fills the single name variable', () => {
    expect(buildWelcomeTemplate(ENV, { publisherName: 'Uri Shiber' })).toEqual({
      contentSid: 'HXwelcome',
      variables: { '1': 'Uri Shiber' },
    });
  });

  it('renders the registered template to exactly the free-form welcome copy', () => {
    const t = buildWelcomeTemplate(ENV, { publisherName: 'Uri Shiber' });
    const rendered = render(REGISTERED_BODY, t?.variables ?? {}).replace(/[ \t]+$/gm, '');
    expect(rendered).toBe(composeWelcomeMessage('Uri Shiber'));
  });

  it('keeps the copy on three lines, as the template lays it out', () => {
    expect(composeWelcomeMessage('Uri Shiber').split('\n')).toHaveLength(3);
  });

  it('returns null (→ free-form fallback) when the SID is not configured', () => {
    expect(buildWelcomeTemplate({}, { publisherName: 'Uri Shiber' })).toBeNull();
  });

  it('returns null on a blank name rather than sending a template with a hole in it', () => {
    expect(buildWelcomeTemplate(ENV, { publisherName: '  ' })).toBeNull();
  });

  it('collapses whitespace in the name (WhatsApp rejects newlines/tabs in variables)', () => {
    const t = buildWelcomeTemplate(ENV, { publisherName: 'Uri\n\tShiber' });
    expect(t?.variables['1']).toBe('Uri Shiber');
  });
});
