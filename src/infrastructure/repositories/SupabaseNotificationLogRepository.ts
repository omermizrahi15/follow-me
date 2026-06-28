import { createClient } from '@supabase/supabase-js';
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
  private client: ReturnType<typeof createClient<Database>>;

  // Accepts the service-role key in production (the edge function writes with it,
  // bypassing RLS); the integration test uses the anon key against a dev policy.
  constructor(url: string, key: string) {
    this.client = createClient<Database>(url, key, { auth: { persistSession: false } });
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
