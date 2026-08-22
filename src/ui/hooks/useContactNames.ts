import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveContactNames } from '../../composition/container';
import type { ContactsAccess } from '../../application/usecases/ResolveContactNamesUseCase';
import type { ResolvedContact } from '../../domain/services/contactNames';

/**
 * Resolved names for the current session (issue #144).
 *
 * The address book is expensive to read and does not change while the
 * publisher is looking at their followers list, so the result is kept here
 * rather than re-read every time the sheet is opened. It is a plain module
 * variable on purpose: it dies with the process, so nothing about the
 * publisher's contacts survives the session — pulling to refresh re-reads the
 * address book instead of trusting a stored copy.
 */
let cachedNames = new Map<string, ResolvedContact>();
/** Handles already looked up, matched or not — a miss is worth caching too. */
let cachedHandles = new Set<string>();

function cachedFor(handles: readonly string[]): Map<string, ResolvedContact> | null {
  return handles.every(handle => cachedHandles.has(handle)) ? cachedNames : null;
}

function cache(handles: readonly string[], names: Map<string, ResolvedContact>): void {
  cachedNames = names;
  cachedHandles = new Set(handles);
}

/** Drops the session cache — exported for tests and sign-out. */
export function forgetContactNames(): void {
  cachedNames = new Map();
  cachedHandles = new Set();
}

interface UseContactNames {
  /** Subscriber handle → matched contact. Unmatched handles are absent. */
  names: ReadonlyMap<string, ResolvedContact>;
  /** Null until the first check comes back. */
  access: ContactsAccess | null;
  /** Shows the OS permission prompt, then resolves. Safe to call twice. */
  enable: () => Promise<void>;
  /** Re-reads the address book, ignoring the session cache. */
  refresh: () => Promise<void>;
}

/**
 * Puts contact names on follower phone numbers, lazily: nothing is read and no
 * permission is asked for until this hook mounts (i.e. the publisher opened
 * their followers list), and a refusal simply leaves `names` empty so callers
 * fall back to the number.
 */
export function useContactNames(
  handles: readonly string[],
  publisherPhone: string | null,
): UseContactNames {
  const [names, setNames] = useState<ReadonlyMap<string, ResolvedContact>>(cachedNames);
  const [access, setAccess] = useState<ContactsAccess | null>(null);
  // Handles arrive as a fresh array on every render; key the effect on their
  // contents so it re-runs when the follower list actually changed.
  const key = handles.join(',');
  const stableHandles = useMemo(() => (key === '' ? [] : key.split(',')), [key]);
  const mounted = useRef(true);
  // Read through a call rather than the ref directly: reading `mounted.current`
  // narrows it for the rest of the function, and TypeScript keeps that
  // narrowing across the awaits below — exactly where it stops being true.
  const isMounted = useCallback((): boolean => mounted.current, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (options: { force: boolean }): Promise<void> => {
      const current = await resolveContactNames.access();
      if (!isMounted()) return;
      setAccess(current);
      if (current !== 'granted') {
        setNames(new Map());
        return;
      }
      const hit = options.force ? null : cachedFor(stableHandles);
      if (hit != null) {
        setNames(hit);
        return;
      }
      const resolved = await resolveContactNames.resolve(stableHandles, publisherPhone);
      cache(stableHandles, resolved);
      if (isMounted()) setNames(resolved);
    },
    [stableHandles, publisherPhone, isMounted],
  );

  useEffect(() => {
    void load({ force: false });
  }, [load]);

  const enable = useCallback(async (): Promise<void> => {
    const granted = await resolveContactNames.requestAccess();
    if (!isMounted()) return;
    setAccess(granted);
    if (granted !== 'granted') return;
    await load({ force: true });
  }, [load, isMounted]);

  const refresh = useCallback((): Promise<void> => load({ force: true }), [load]);

  return { names, access, enable, refresh };
}
