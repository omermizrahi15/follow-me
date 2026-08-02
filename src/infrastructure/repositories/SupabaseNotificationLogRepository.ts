import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database';
import type {
  INotificationLog,
  NotificationLogEntry,
  RecordedNotificationLogEntry,
} from '../../domain/interfaces';

type LogRow = Database['public']['Tables']['notification_log']['Row'];

function rowToEntry(row: LogRow): RecordedNotificationLogEntry {
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    publisherId: row.publisher_id,
    contactHandle: row.contact_handle,
    event: row.event as RecordedNotificationLogEntry['event'],
    ...(row.detail != null ? { detail: row.detail } : {}),
    createdAt: row.created_at,
  };
}

export class SupabaseNotificationLogRepository implements INotificationLog {
  // Takes a service-role client in production (the edge function writes with it,
  // bypassing RLS); the integration test passes one built from the anon key.
  constructor(private readonly client: SupabaseClient<Database>) {}

  async record(entry: NotificationLogEntry): Promise<void> {
    const { error } = await this.client.from('notification_log').insert({
      subscriber_id: entry.subscriberId,
      publisher_id: entry.publisherId,
      contact_handle: entry.contactHandle,
      event: entry.event,
      detail: entry.detail ?? null,
    });
    if (error != null) throw new Error(error.message);
  }

  async findByContact(contactHandle: string): Promise<RecordedNotificationLogEntry[]> {
    const { data, error } = await this.client
      .from('notification_log')
      .select('*')
      .eq('contact_handle', contactHandle)
      .order('created_at', { ascending: true });
    if (error != null) throw new Error(error.message);
    return data.map(rowToEntry);
  }
}
