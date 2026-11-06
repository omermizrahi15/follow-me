import { useEffect, useState } from 'react';
import { searchSongs } from '../../composition/container';
import type { Song } from '../../domain/entities/Song';

/** Debounced song search; a slow answer to an older term never overwrites a newer one. */
export function useSongSearch(): {
  term: string;
  setTerm: (term: string) => void;
  results: Song[];
  searching: boolean;
} {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (term.trim() === '') {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchSongs.search(term).then(found => {
        if (cancelled) return;
        setResults(found);
        setSearching(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  return { term, setTerm, results, searching };
}
