import { SearchSongsUseCase } from './SearchSongsUseCase';
import type { IMusicCatalog } from '../../domain/interfaces';

function makeCatalog(): IMusicCatalog & { terms: string[] } {
  const terms: string[] = [];
  return {
    terms,
    searchSongs: (term: string) => {
      terms.push(term);
      return Promise.resolve([{ title: 'Vienna', artist: 'Billy Joel' }]);
    },
  };
}

describe('SearchSongsUseCase', () => {
  it('trims the term and returns matches', async () => {
    const catalog = makeCatalog();
    expect(await new SearchSongsUseCase(catalog).search('  vienna ')).toEqual([{ title: 'Vienna', artist: 'Billy Joel' }]);
    expect(catalog.terms).toEqual(['vienna']);
  });

  it('skips the catalog for a blank term', async () => {
    const catalog = makeCatalog();
    expect(await new SearchSongsUseCase(catalog).search('  ')).toEqual([]);
    expect(catalog.terms).toEqual([]);
  });
});
