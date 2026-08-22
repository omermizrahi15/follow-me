/**
 * Tests for the new-follower welcome template used by `subscribe` (issue #164).
 *
 * The body below is the one registered in Twilio as `follow_me_welcome`. It is
 * asserted against `composeWelcomeMessage` so the template and the free-form
 * fallback can never drift: a follower gets the same words whichever path
 * delivered them. Re-cutting the template means changing both together (and
 * re-submitting it to Meta for approval).
 */
import { composeWelcomeMessage } from '../../domain/services/optOutMessages';
import { buildWelcomeTemplate } from '../../../supabase/functions/_shared/welcomeTemplate';

const ENV = { welcomeSid: 'HXwelcome' };

/** The approved template body, verbatim, with its {{1}} placeholder. */
const TEMPLATE_BODY =
  "You're now following {{1}}. You'll receive their photos here on WhatsApp. Reply STOP at any time to unsubscribe.";

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

  it('renders to exactly the free-form welcome copy', () => {
    const t = buildWelcomeTemplate(ENV, { publisherName: 'Uri Shiber' });
    expect(render(TEMPLATE_BODY, t?.variables ?? {})).toBe(composeWelcomeMessage('Uri Shiber'));
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
