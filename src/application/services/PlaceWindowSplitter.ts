import type { IMediaLibrary } from "../../domain/interfaces";
import type { HistoryWindow } from "../../domain/services/historyWindows";
import { sampleForPlaceProbe } from "../../domain/services/placeSampling";
import { windowsByPlace } from "../../domain/services/placeWindows";

/**
 * Cuts a history window at the places the publisher actually was (issue #112).
 *
 * Reads GPS for two photos a day rather than all of them — a lookup per photo
 * is what made this slow to start with — and lets the rest follow the stay
 * their timestamp falls in. A library that cannot read locations leaves the
 * window whole.
 */
export class PlaceWindowSplitter {
  constructor(private readonly library: IMediaLibrary) {}

  readonly splitWindow = async (
    window: HistoryWindow,
  ): Promise<HistoryWindow[]> => {
    const locate = this.library.locateAssets?.bind(this.library);
    if (locate == null) return [window];

    const photos = await this.library.photosBetween(window.start, window.end);
    if (photos.length === 0) return [window];

    const timed = photos.map((p) => ({ id: p.id, takenAt: p.createdAt }));
    const sampled = new Set(sampleForPlaceProbe(timed));
    const where = await locate(photos.filter((p) => sampled.has(p.id)));

    return windowsByPlace(window, timed, (id) => where.get(id));
  };
}
