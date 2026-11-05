import type { Song } from '../entities/Song';

/** Searches a public music catalog by title or artist. */
export interface IMusicCatalog {
  /** Best matches first; empty when nothing matches. */
  searchSongs(term: string): Promise<Song[]>;
}
