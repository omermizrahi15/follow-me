// Defined by the pure clustering service rather than here: that module is
// imported verbatim by the Deno Edge Functions, so it has to own every type it
// touches (see CONTRIBUTING.md). Re-exported so `Coordinate` still reads as
// part of the domain's vocabulary.
export type { Coordinate } from '../services/postingLocation';
import type { Coordinate } from '../services/postingLocation';

export interface IGeocoder {
  /** Human place label ("City, Country") for a coordinate; null when unresolvable. */
  reverseGeocode(coordinate: Coordinate): Promise<string | null>;
}

/** A place the publisher can choose when their photos carry no GPS. */
export interface PlaceSuggestion {
  /** Stable id for list keys — the provider's own feature id. */
  id: string;
  /** What the publisher sees and what is stored as the posting's place. */
  label: string;
  /** Where it puts the pin. A suggestion without one is not offered. */
  coordinate: Coordinate;
}

/**
 * Searching for a place by name. Only reached when a batch has no GPS at all:
 * a picked place carries a real coordinate, so the posting can be plotted
 * rather than guessed at from its label later.
 */
export interface IPlaceSearch {
  search(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
}
