import { describeClassifyFailure } from './GeminiPhotoClassifier';

describe('describeClassifyFailure', () => {
  it('leads with the provider reason, not the JSON envelope (issue #234)', () => {
    const body = JSON.stringify({
      error: 'Classification failed',
      photo_id: 'ABC/L0/001',
      detail:
        'groq error (413): {"error":{"message":"Request too large for model `x` on tokens per minute (TPM): Limit 8000, Requested 9500"}}',
    });
    const msg = describeClassifyFailure(502, body);
    expect(msg).toBe(
      'Photo AI failed (HTTP 502): groq error (413): Request too large for model `x` on tokens per minute (TPM): Limit 8000, Requested 9500 [photo ABC/L0/001]',
    );
  });

  it('keeps plain text bodies', () => {
    expect(describeClassifyFailure(500, 'upstream exploded')).toBe('Photo AI failed (HTTP 500): upstream exploded');
  });
});
