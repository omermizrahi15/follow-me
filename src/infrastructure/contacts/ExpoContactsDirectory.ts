import * as Contacts from 'expo-contacts';
import type { ContactsPermission, DeviceContact, IContactsDirectory } from '../../domain/interfaces';

/** Contacts fetched per page — the whole address book is walked, in chunks. */
const PAGE_SIZE = 300;

/**
 * The device address book, via expo-contacts (issue #144).
 *
 * The only place in the app that touches contacts. It reads three fields —
 * name, phone numbers, contact photo uri — and hands them to the pure matcher
 * in the domain; nothing here uploads, persists, or logs any of it, and the
 * data lives only as long as the followers list is on screen.
 *
 * Permission is requested lazily by the caller (the followers list), never at
 * startup: `permission()` never prompts, `requestPermission()` is what shows
 * the OS dialog.
 */
export class ExpoContactsDirectory implements IContactsDirectory {
  async isAvailable(): Promise<boolean> {
    try {
      return await Contacts.isAvailableAsync();
    } catch {
      // No contacts module on this platform — matching is an enhancement, so
      // an unavailable address book is a quiet "no names", not an error.
      return false;
    }
  }

  async permission(): Promise<ContactsPermission> {
    return toPermission(await Contacts.getPermissionsAsync());
  }

  async requestPermission(): Promise<ContactsPermission> {
    return toPermission(await Contacts.requestPermissionsAsync());
  }

  async list(): Promise<DeviceContact[]> {
    const contacts: DeviceContact[] = [];
    let offset = 0;

    for (;;) {
      const page = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Image],
        pageSize: PAGE_SIZE,
        pageOffset: offset,
      });

      for (const contact of page.data) {
        const phoneNumbers = (contact.phoneNumbers ?? [])
          .map(entry => entry.number ?? entry.digits)
          .filter((number): number is string => number != null && number.trim() !== '');
        // An entry with no number can never match a follower.
        if (phoneNumbers.length === 0) continue;
        contacts.push({
          id: contact.id,
          name: contact.name,
          imageUri: contact.image?.uri ?? null,
          phoneNumbers,
        });
      }

      if (!page.hasNextPage) break;
      offset += page.data.length;
      // Defensive: a page that returns nothing while still claiming a next page
      // would spin forever.
      if (page.data.length === 0) break;
    }

    return contacts;
  }
}

/**
 * iOS 18 lets the user share only *selected* contacts ('limited'). That still
 * returns a usable address book, so it counts as granted — the matcher simply
 * sees fewer entries and the rest of the followers fall back to their numbers.
 */
function toPermission(response: Contacts.ContactsPermissionResponse): ContactsPermission {
  if (response.granted) return 'granted';
  if (response.canAskAgain && response.status === Contacts.PermissionStatus.UNDETERMINED) {
    return 'undetermined';
  }
  return 'denied';
}
