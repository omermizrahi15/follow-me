import type { ContactsPermission, IContactsDirectory } from '../../domain/interfaces';
import { callingCodeOf } from '../../domain/services/phoneNumber';
import { resolveContactNames, type ResolvedContact } from '../../domain/services/contactNames';

/**
 * 'unavailable' means there is no address book to ask about — a platform
 * without contacts, where even offering the permission would be noise.
 */
export type ContactsAccess = ContactsPermission | 'unavailable';

/**
 * Puts a name on a follower's phone number by matching it against the device
 * address book (issue #144).
 *
 * Reading contacts is an enhancement, never a dependency: every failure path —
 * no address book, permission refused, nothing matched, the read itself
 * throwing — resolves to "no names", and the caller shows raw numbers exactly
 * as it did before.
 *
 * Contacts never leave the device. The address book is read here, matched by
 * pure domain code, and the only thing that escapes this use case is a map from
 * numbers the app already knew about to the names of *those* numbers.
 */
export class ResolveContactNamesUseCase {
  constructor(private readonly contacts: IContactsDirectory) {}

  /** Current access, without ever prompting. */
  async access(): Promise<ContactsAccess> {
    try {
      if (!(await this.contacts.isAvailable())) return 'unavailable';
      return await this.contacts.permission();
    } catch {
      return 'unavailable';
    }
  }

  /** Shows the OS permission prompt. Call it from an explicit user action. */
  async requestAccess(): Promise<ContactsAccess> {
    try {
      if (!(await this.contacts.isAvailable())) return 'unavailable';
      return await this.contacts.requestPermission();
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Subscriber handle → matched contact, for the handles that matched. Returns
   * an empty map when contacts can't be read; unmatched handles are absent
   * rather than present-and-null, so a caller can only render a name it has.
   *
   * `publisherPhone` is the publisher's own E.164 number: its calling code is
   * the default country for address-book entries saved in national form.
   */
  async resolve(
    handles: readonly string[],
    publisherPhone: string | null,
  ): Promise<Map<string, ResolvedContact>> {
    if (handles.length === 0) return new Map();
    try {
      if (!(await this.contacts.isAvailable())) return new Map();
      if ((await this.contacts.permission()) !== 'granted') return new Map();
      const contacts = await this.contacts.list();
      return resolveContactNames(contacts, handles, callingCodeOf(publisherPhone));
    } catch {
      return new Map();
    }
  }
}
