import { PlaceWindowSplitter } from './PlaceWindowSplitter';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { IMediaLibrary } from '../../domain/interfaces';

const MADRID = { latitude: 40.4, longitude: -3.7 };
const LISBON = { latitude: 38.7, longitude: -9.1 };
const window = { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-06-08T00:00:00Z') };

function photo(id: string, day: number, hour: number): PhotoCandidate {
  return { id, uri: id, createdAt: new Date(Date.UTC(2026, 5, day, hour)) };
}

const photos = [1, 2, 3, 5, 6, 7].flatMap(d =>
  [9, 11, 13, 15, 18].map(h => photo(`${d}-${h}`, d, h)),
);

function library(): IMediaLibrary & { located: string[] } {
  const located: string[] = [];
  return {
    located,
    photosBetween: () => Promise.resolve(photos),
    locateAssets: candidates => {
      candidates.forEach(c => located.push(c.id));
      return Promise.resolve(
        new Map(candidates.map(c => [c.id, c.createdAt.getUTCDate() <= 3 ? MADRID : LISBON])),
      );
    },
  };
}

describe('PlaceWindowSplitter', () => {
  it('cuts a window at the change of place', async () => {
    const out = await new PlaceWindowSplitter(library()).splitWindow(window);
    expect(out).toHaveLength(2);
  });

  it('reads GPS from a sample, not from every photo', async () => {
    const lib = library();
    await new PlaceWindowSplitter(lib).splitWindow(window);
    expect(photos).toHaveLength(30);
    // About two per local day, whatever the timezone — never the whole window.
    expect(lib.located.length).toBeLessThanOrEqual(18);
  });

  it('returns the window whole when the library cannot read locations', async () => {
    const lib: IMediaLibrary = { photosBetween: () => Promise.resolve(photos) };
    expect(await new PlaceWindowSplitter(lib).splitWindow(window)).toEqual([window]);
  });
});
