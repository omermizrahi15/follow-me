import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';
import type {
  INotificationLog,
  NotificationLogEntry,
  RecordedNotificationLogEntry,
} from '../../domain/interfaces';

interface Database {
  public: {
    Tables: {
      notification_log: {
        Row: {
          id: string;
          subscriber_id: string | null;
          publisher_id: string;
          contact_handle: string;
          event: string;
          detail: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          subscriber_id?: string | null;
          publisher_id: string;
          contact_handle: string;
          event: string;
          detail?: string | null;
          created_at?: string;
        };
        Update: { [_ in never]: never };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

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
  private readonly client: SupabaseClient<Database>;

  // `notification_log` has no policy for any client-side role — the production
  // writer is the edge function's service-role client, which bypasses RLS. The
  // integration test builds a service-role client and passes it in here.
  constructor(client: AppSupabaseClient) {
    this.client = client as unknown as SupabaseClient<Database>;
  }

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
