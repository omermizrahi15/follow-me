export interface Coordinate {
  latitude: number;
  longitude: number;
}

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
