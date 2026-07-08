import { createClient } from '@supabase/supabase-js';
import type {
  DeliveryStatus,
  INotificationLogger,
  NotificationDelivery,
  RecordedNotificationDelivery,
} from '../../domain/interfaces';

interface Database {
  public: {
    Tables: {
      notification_deliveries: {
        Row: {
          id: string;
          photo_id: string;
          subscriber_id: string;
          publisher_id: string;
          status: string;
          attempts: number;
          last_attempted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          photo_id: string;
          subscriber_id: string;
          publisher_id: string;
          status?: string;
          attempts?: number;
          last_attempted_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: string;
          attempts?: number;
          last_attempted_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

type DeliveryRow = Database['public']['Tables']['notification_deliveries']['Row'];

function rowToDelivery(row: DeliveryRow): RecordedNotificationDelivery {
  return {
    photoId: row.photo_id,
    subscriberId: row.subscriber_id,
    publisherId: row.publisher_id,
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    lastAttemptedAt: row.last_attempted_at,
  };
}

/**
 * Delivery tracking in the notification_deliveries table (issue #11).
 * Distinct from SupabaseNotificationLogRepository, which is the opt-out/opt-in
 * compliance audit in notification_log.
 */
export class SupabaseNotificationDeliveryRepository implements INotificationLogger {
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, key: string) {
    this.client = createClient<Database>(url, key, { auth: { persistSession: false } });
  }

  async logPending(deliveries: NotificationDelivery[]): Promise<void> {
    if (deliveries.length === 0) return;
    // Re-sharing the same photo to the same subscriber resets the row.
    const { error } = await this.client.from('notification_deliveries').upsert(
      deliveries.map(d => ({
        photo_id: d.photoId,
        subscriber_id: d.subscriberId,
        publisher_id: d.publisherId,
        status: 'pending',
        attempts: 0,
        last_attempted_at: null,
      })),
      { onConflict: 'photo_id,subscriber_id' },
    );
    if (error != null) throw new Error(error.message);
  }

  // The retrying notifier passes the 1-based attempt number, so the write is a
  // plain set — no read-modify-write increment race.
  async recordAttempt(photoIds: string[], subscriberId: string, attempt: number): Promise<void> {
    await this.update(photoIds, subscriberId, {
      attempts: attempt,
      last_attempted_at: new Date().toISOString(),
    });
  }

  async markSent(photoIds: string[], subscriberId: string): Promise<void> {
    await this.update(photoIds, subscriberId, { status: 'sent' });
  }

  async markFailed(photoIds: string[], subscriberId: string): Promise<void> {
    await this.update(photoIds, subscriberId, { status: 'failed' });
  }

  async findByPhoto(photoId: string): Promise<RecordedNotificationDelivery[]> {
    const { data, error } = await this.client
      .from('notification_deliveries')
      .select('*')
      .eq('photo_id', photoId)
      .order('created_at', { ascending: true });
    if (error != null) throw new Error(error.message);
    return data.map(rowToDelivery);
  }

  private async update(
    photoIds: string[],
    subscriberId: string,
    patch: Database['public']['Tables']['notification_deliveries']['Update'],
  ): Promise<void> {
    if (photoIds.length === 0) return;
    const { error } = await this.client
      .from('notification_deliveries')
      .update(patch)
      .in('photo_id', photoIds)
      .eq('subscriber_id', subscriberId);
    if (error != null) throw new Error(error.message);
  }
}
