import { bestFirst, burstScore } from './burstRanking';
import type { PhotoCandidate } from '../entities/PhotoCandidate';

const at = (iso: string): Date => new Date(iso);

function photo(id: string, over: Partial<PhotoCandidate> = {}): PhotoCandidate {
  return {
    id,
    uri: `ph://${id}`,
    createdAt: at('2026-08-01T10:00:00Z'),
    width: 4032,
    height: 3024,
    ...over,
  };
}

const ids = (photos: PhotoCandidate[]): string[] => photos.map(p => p.id);

describe('bestFirst — which frame of a burst is the keeper', () => {
  // The old rule was "whichever was shot first", which is close to the worst
  // possible choice: the first frame of a held shutter is the one taken while
  // still raising the phone. It decided which photo the AI graded and which one
  // the publisher was offered, so a burst of eight reliably produced the
  // clumsiest of the eight.
  it('prefers the frame the publisher hearted over everything else', () => {
    const burst = [
      photo('a', { byteSize: 5_000_000 }),
      photo('b', { isFavorite: true, byteSize: 1_000_000 }),
      photo('c', { byteSize: 4_000_000 }),
    ];

    expect(ids(bestFirst(burst))[0]).toBe('b');
  });

  it('prefers a frame the publisher edited over one they never touched', () => {
    const burst = [
      photo('untouched', { byteSize: 3_000_000 }),
      photo('edited', { byteSize: 3_000_000, editedAt: at('2026-08-02T10:00:00Z') }),
    ];

    expect(ids(bestFirst(burst))[0]).toBe('edited');
  });

  // The no-AI sharpness proxy. A JPEG stores detail, so at the same resolution
  // and the same scene the motion-blurred frame compresses smaller — often by a
  // third. It is not a perfect measure of sharpness and does not need to be:
  // it only has to order frames of ONE moment, where everything else is held
  // constant.
  it('prefers the denser file when nothing human distinguishes them', () => {
    const burst = [
      photo('blurred', { byteSize: 1_800_000 }),
      photo('sharp', { byteSize: 3_400_000 }),
    ];

    expect(ids(bestFirst(burst))[0]).toBe('sharp');
  });

  // Bytes alone would hand it to the bigger image regardless of detail, so the
  // comparison is bytes per megapixel.
  it('compares density, not size, so a big soft frame loses to a small crisp one', () => {
    const burst = [
      photo('big-soft', { width: 8000, height: 6000, byteSize: 4_000_000 }),
      photo('small-crisp', { width: 2000, height: 1500, byteSize: 2_000_000 }),
    ];

    expect(ids(bestFirst(burst))[0]).toBe('small-crisp');
  });

  // The settled frame at the end of a held shutter beats the one from while
  // the phone was still moving. Only a tie-break — but a better default than
  // the reverse, which is what shipped.
  it('falls back to the last frame of the burst, not the first', () => {
    const burst = [
      photo('first', { createdAt: at('2026-08-01T10:00:00Z') }),
      photo('last', { createdAt: at('2026-08-01T10:00:06Z') }),
    ];

    expect(ids(bestFirst(burst))).toEqual(['last', 'first']);
  });

  it('orders the also-rans too, so a swap gets the next best rather than the next oldest', () => {
    const burst = [
      photo('worst', { byteSize: 1_000_000 }),
      photo('best', { byteSize: 4_000_000 }),
      photo('middle', { byteSize: 2_500_000 }),
    ];

    expect(ids(bestFirst(burst))).toEqual(['best', 'middle', 'worst']);
  });

  it('never drops a frame — every photo in, every photo out', () => {
    const burst = [photo('a'), photo('b'), photo('c')];
    expect(bestFirst(burst)).toHaveLength(3);
  });

  it('is stable when the library told us nothing at all', () => {
    const bare = [
      { id: 'x', uri: 'ph://x', createdAt: at('2026-08-01T10:00:00Z') },
      { id: 'y', uri: 'ph://y', createdAt: at('2026-08-01T10:00:03Z') },
    ];

    expect(ids(bestFirst(bare))).toEqual(['y', 'x']);
  });
});

describe('burstScore — what each signal is worth', () => {
  it('scores a hearted photo above any unhearted one, whatever its file', () => {
    const hearted = burstScore(photo('a', { isFavorite: true, byteSize: 1 }));
    const dense = burstScore(photo('b', { byteSize: 50_000_000 }));

    expect(hearted).toBeGreaterThan(dense);
  });

  // Density is a proxy, not a truth, so it must not be able to outvote the two
  // signals that come from the publisher themselves.
  it('caps what density can be worth, so a proxy cannot outvote a person', () => {
    const edited = burstScore(photo('a', { editedAt: at('2026-08-02T10:00:00Z'), byteSize: 1 }));
    const dense = burstScore(photo('b', { byteSize: 50_000_000 }));

    expect(edited).toBeGreaterThan(dense);
  });

  it('says nothing about a photo whose size the library never reported', () => {
    expect(burstScore(photo('a'))).toBe(burstScore(photo('b')));
  });
});
