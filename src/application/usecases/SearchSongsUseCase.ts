import type { Song } from '../../domain/entities/Song';
import type { IMusicCatalog } from '../../domain/interfaces';

/** Plain catalog lookup for the composer's "Add music". */
export class SearchSongsUseCase {
  constructor(private readonly catalog: IMusicCatalog) {}

  async search(term: string): Promise<Song[]> {
    const trimmed = term.trim();
    return trimmed === '' ? [] : this.catalog.searchSongs(trimmed);
  }
}
