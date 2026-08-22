import type { DeviceContact } from '../interfaces';
import { toE164 } from './phoneNumber';

/**
 * Matching followers to address-book entries (issue #144).
 *
 * Pure functions over data the caller already holds: contacts in, a
 * handle → name map out. Nothing here reads the address book or talks to the
 * network, which is what makes "contacts never leave the device" checkable
 * rather than a promise — the only code that sees a `DeviceContact` is this
 * module, the adapter that produced it, and the row that renders the name.
 */

/** What a follower row shows once its number is matched. */
export interface ResolvedContact {
  name: string;
  /** Local uri of the contact photo, when they have one. */
  imageUri: string | null;
}

/**
 * Contact names keyed by E.164 number. A contact with several numbers appears
 * under each of them; several contacts sharing one number collapse to a single
 * winner (see `preferred`) so a follower never changes name between launches
 * just because the address book came back in a different order.
 *
 * Contacts without a usable name are dropped — a nameless entry has nothing to
 * show that the number itself doesn't.
 */
export function indexContactsByNumber(
  contacts: readonly DeviceContact[],
  defaultCallingCode: string | null,
): Map<string, ResolvedContact> {
  const index = new Map<string, DeviceContact>();
  for (const contact of contacts) {
    if (displayName(contact) == null) continue;
    for (const raw of contact.phoneNumbers) {
      const number = toE164(raw, defaultCallingCode);
      if (number == null) continue;
      const existing = index.get(number);
      if (existing == null || preferred(existing, contact) === contact) index.set(number, contact);
    }
  }

  const resolved = new Map<string, ResolvedContact>();
  for (const [number, contact] of index) {
    const name = displayName(contact);
    if (name != null) resolved.set(number, { name, imageUri: contact.imageUri });
  }
  return resolved;
}

/**
 * Subscriber handle → matched contact, for the handles that matched. Handles
 * are normalised the same way the contacts were, so an address book holding
 * `050-123 4567` still matches a `+972501234567` subscriber.
 */
export function matchHandlesToContacts(
  handles: readonly string[],
  index: ReadonlyMap<string, ResolvedContact>,
  defaultCallingCode: string | null,
): Map<string, ResolvedContact> {
  const matches = new Map<string, ResolvedContact>();
  for (const handle of handles) {
    const number = toE164(handle, defaultCallingCode);
    if (number == null) continue;
    const contact = index.get(number);
    if (contact != null) matches.set(handle, contact);
  }
  return matches;
}

/** `indexContactsByNumber` + `matchHandlesToContacts` in one pass. */
export function resolveContactNames(
  contacts: readonly DeviceContact[],
  handles: readonly string[],
  defaultCallingCode: string | null,
): Map<string, ResolvedContact> {
  return matchHandlesToContacts(
    handles,
    indexContactsByNumber(contacts, defaultCallingCode),
    defaultCallingCode,
  );
}

/**
 * Followers ordered by the name the publisher actually sees: matched contacts
 * alphabetically first, then the unmatched numbers. Sorting on the raw handle
 * throughout would scatter the named rows through the list by area code.
 */
export function sortByResolvedName<T>(
  items: readonly T[],
  resolvedNameOf: (item: T) => string | null,
  fallbackOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const nameA = resolvedNameOf(a);
    const nameB = resolvedNameOf(b);
    if (nameA != null && nameB != null) return compareNames(nameA, nameB);
    if (nameA != null) return -1;
    if (nameB != null) return 1;
    return compareNames(fallbackOf(a), fallbackOf(b));
  });
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function displayName(contact: DeviceContact): string | null {
  const name = contact.name?.trim() ?? '';
  return name === '' ? null : name;
}

/**
 * The contact to show when two entries claim the same number — a shared house
 * line, or the same person saved twice. Prefers the one with a photo, then the
 * alphabetically-first name, then the lower id; every step is a total order, so
 * the winner does not depend on the order contacts arrived in.
 */
function preferred(a: DeviceContact, b: DeviceContact): DeviceContact {
  if ((a.imageUri != null) !== (b.imageUri != null)) return a.imageUri != null ? a : b;
  const byName = compareNames(displayName(a) ?? '', displayName(b) ?? '');
  if (byName !== 0) return byName < 0 ? a : b;
  return a.id <= b.id ? a : b;
}
