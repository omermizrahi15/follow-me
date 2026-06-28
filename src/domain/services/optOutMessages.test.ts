import {
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
