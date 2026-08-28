import {
  composeWelcomeMessage,
  composeUnsubscribeConfirmation,
  composeResubscribeConfirmation,
} from './optOutMessages';

describe('composeUnsubscribeConfirmation', () => {
  it('names the publisher and tells the user how to re-subscribe', () => {
    const body = composeUnsubscribeConfirmation('Omer');
    expect(body).toBe("You've been unsubscribed from Omer. Reply START to re-subscribe.");
  });

  it('mentions START so the opt-out is reversible', () => {
    expect(composeUnsubscribeConfirmation('Dana')).toContain('START');
  });

  it('includes whatever publisher name is given', () => {
    expect(composeUnsubscribeConfirmation('Studio Ghibli')).toContain('Studio Ghibli');
  });
});

describe('composeResubscribeConfirmation', () => {
  it('confirms the re-subscribe and names the publisher', () => {
    const body = composeResubscribeConfirmation('Omer');
    expect(body).toBe("You're following Omer again. Reply STOP at any time to unsubscribe.");
  });

  it('mentions STOP so the user still knows how to opt out', () => {
    expect(composeResubscribeConfirmation('Dana')).toContain('STOP');
  });
});

describe('composeWelcomeMessage', () => {
  const FEED = 'https://omermizrahi15.github.io/follow-me/gallery.html?u=pub-1';

  it('names the publisher, links their feed and mentions STOP', () => {
    expect(composeWelcomeMessage('Omer', FEED)).toBe(
      "You're now following Omer.\n" +
        "You'll receive their photos here on WhatsApp.\n" +
        `All their posts in one place: ${FEED}\n` +
        'Reply STOP at any time to unsubscribe.',
    );
  });

  it('lays the copy out on four lines, as the template does', () => {
    expect(composeWelcomeMessage('Omer', FEED).split('\n')).toHaveLength(4);
  });

  it('keeps the link off the last line — WhatsApp rejects a body ending in a variable', () => {
    const lines = composeWelcomeMessage('Omer', FEED).split('\n');
    expect(lines.at(-1)).not.toContain(FEED);
  });
});
