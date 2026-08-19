/**
 * The device address book (issue #144).
 *
 * Contacts are read to put a name on a follower's phone number and never leave
 * the device: nothing an implementation returns here may be uploaded, logged,
 * or persisted. The port exists so the matching logic stays pure and testable,
 * and so the only code that ever touches the address book is one adapter.
 */

/** Whether the app may read the address book right now. */
export type ContactsPermission = 'granted' | 'denied' | 'undetermined';

/** One address-book entry, reduced to what a follower row needs. */
export interface DeviceContact {
  id: string;
  /** Display name, or null for an entry that has only a number. */
  name: string | null;
  /** Local uri of the contact photo, when they have one. */
  imageUri: string | null;
  /** Every number on the contact, in whatever format the address book holds. */
  phoneNumbers: string[];
}

export interface IContactsDirectory {
  /** False where there is no address book at all (web, unsupported platform). */
  isAvailable(): Promise<boolean>;
  /** Current permission, asked without ever showing a prompt. */
  permission(): Promise<ContactsPermission>;
  /** Shows the OS prompt when the permission is still undetermined. */
  requestPermission(): Promise<ContactsPermission>;
  /** Every contact holding at least one phone number. Requires permission. */
  list(): Promise<DeviceContact[]>;
}
