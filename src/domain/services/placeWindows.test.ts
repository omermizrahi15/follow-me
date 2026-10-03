import { windowsByPlace } from './placeWindows';
import type { HistoryWindow } from './historyWindows';

const MADRID = { latitude: 40.4, longitude: -3.7 };
const LISBON = { latitude: 38.7, longitude: -9.1 };

const window: HistoryWindow = {
  start: new Date('2026-06-01T00:00:00Z'),
  end: new Date('2026-06-08T00:00:00Z'),
};

const photo = (id: string, day: number, hour = 12): { id: string; takenAt: Date } => ({
  id,
  takenAt: new Date(Date.UTC(2026, 5, day, hour)),
});

const madridDays = [1, 2, 3].flatMap(d => [photo(`m${d}a`, d, 9), photo(`m${d}b`, d, 18)]);
const lisbonDays = [5, 6, 7].flatMap(d => [photo(`l${d}a`, d, 9), photo(`l${d}b`, d, 18)]);

function coords(map: Record<string, typeof MADRID>): (id: string) => typeof MADRID | undefined {
  return (id: string) => map[id];
}

const located: Record<string, typeof MADRID> = {};
madridDays.forEach(p => { located[p.id] = MADRID; });
lisbonDays.forEach(p => { located[p.id] = LISBON; });

describe('windowsByPlace', () => {
  it('keeps a window whose photos are all in one place as it was', () => {
    const out = windowsByPlace(window, madridDays, coords(located));
    expect(out).toEqual([window]);
  });

  it('cuts a window into one sub-window per place, covering it with no gaps', () => {
    const out = windowsByPlace(window, [...madridDays, ...lisbonDays], coords(located));

    expect(out).toHaveLength(2);
    expect(out[0]!.start).toEqual(window.start);
    expect(out[1]!.end).toEqual(window.end);
    expect(out[0]!.end).toEqual(out[1]!.start);
    // The cut falls between the last Madrid photo and the first Lisbon one.
    expect(out[0]!.end.getTime()).toBeGreaterThan(Date.UTC(2026, 5, 3, 18));
    expect(out[0]!.end.getTime()).toBeLessThan(Date.UTC(2026, 5, 5, 9));
  });

  it('leaves a window alone when no photo has a fix', () => {
    const out = windowsByPlace(window, madridDays, () => undefined);
    expect(out).toEqual([window]);
  });

  it('leaves an empty window alone', () => {
    expect(windowsByPlace(window, [], () => undefined)).toEqual([window]);
  });

  it('does not split on a stray single photo elsewhere', () => {
    const stray = { ...located, m2a: LISBON };
    const out = windowsByPlace(window, madridDays, coords(stray));
    expect(out).toEqual([window]);
  });
});
