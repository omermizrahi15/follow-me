import { useCallback, useEffect, useRef, useState } from 'react';
import { searchSongs, suggestSong } from '../../composition/container';
import type { Song } from '../../domain/entities/Song';

const SEARCH_DEBOUNCE_MS = 350;

interface SongPickerState {
  /** The AI pick currently on offer, or null (loading / unavailable). */
  suggestion: Song | null;
  suggestionLoading: boolean;
  /** False once suggestions proved unavailable — the card hides entirely. */
  suggestionAvailable: boolean;
  /** Ask for a different suggestion (walks the batch, refetches when exhausted). */
  nextSuggestion: () => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searchResults: Song[];
  searching: boolean;
}

/**
 * State for the song picker sheet (issue #54): an AI suggestion the publisher
 * can accept or reroll, plus debounced manual catalog search. The suggester
 * sees (a few of) the actual photos, so the pick matches what's in them.
 * Suggestions load in batches — "try another" walks the batch first and only
 * refetches (with everything shown so far excluded) once the batch is
 * exhausted.
 */
export function useSongPicker(context: { place?: string; photoCount?: number; photoUris?: string[] }): SongPickerState {
  const [batch, setBatch] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [suggestionLoading, setSuggestionLoading] = useState(true);
  const [suggestionAvailable, setSuggestionAvailable] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  // Everything ever offered this session — refetches exclude it all.
  const shownRef = useRef<Song[]>([]);
  const { place, photoCount, photoUris } = context;
  // The uris array is rebuilt every render by callers — keep the callback's
  // identity stable on its content, not its reference.
  const photoUrisKey = photoUris?.join('|') ?? '';
  const photoUrisRef = useRef(photoUris);
  photoUrisRef.current = photoUris;

  const fetchBatch = useCallback(async (): Promise<void> => {
    setSuggestionLoading(true);
    try {
      const uris = photoUrisRef.current;
      const songs = await suggestSong({
        ...(place != null && place !== '' ? { place } : {}),
        ...(photoCount != null ? { photoCount } : {}),
        ...(uris != null && uris.length > 0 ? { photoUris: uris } : {}),
        ...(shownRef.current.length > 0 ? { exclude: shownRef.current } : {}),
      });
      if (songs == null || songs.length === 0) {
        // Unconfigured or exhausted — hide the card rather than spin forever.
        if (shownRef.current.length === 0) setSuggestionAvailable(false);
        return;
      }
      shownRef.current = [...shownRef.current, ...songs];
      setBatch(songs);
      setIndex(0);
    } finally {
      setSuggestionLoading(false);
    }
    // photoUrisKey stands in for the photoUris array (content-stable identity).
  }, [place, photoCount, photoUrisKey]);

  useEffect(() => {
    void fetchBatch();
  }, [fetchBatch]);

  const nextSuggestion = useCallback((): void => {
    if (index + 1 < batch.length) setIndex(index + 1);
    else void fetchBatch();
  }, [index, batch.length, fetchBatch]);

  // Debounced manual search; stale responses are ignored.
  useEffect(() => {
    const term = searchTerm.trim();
    if (term === '') {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const run = { cancelled: false };
    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        const results = await searchSongs(term);
        if (run.cancelled) return;
        setSearchResults(results);
        setSearching(false);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      run.cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  return {
    suggestion: suggestionLoading ? null : batch[index] ?? null,
    suggestionLoading,
    suggestionAvailable,
    nextSuggestion,
    searchTerm,
    setSearchTerm,
    searchResults,
    searching,
  };
}
