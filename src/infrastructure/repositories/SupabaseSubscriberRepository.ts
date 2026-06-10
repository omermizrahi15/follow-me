import { createClient } from '@supabase/supabase-js';
import type { ISubscriberRepository } from '../../domain/interfaces';
import { Subscriber } from '../../domain/entities/Subscriber';
import type { SubscriptionStatus } from '../../domain/entities/Subscriber';

interface Database {
  public: {
    Tables: {
      subscribers: {
        Row: { id: string; publisher_id: string; contact_handle: string; status: string };
        Insert: { id: string; publisher_id: string; contact_handle: string; status: string };
        Update: { id?: string; publisher_id?: string; contact_handle?: string; status?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

type SubscriberRow = Database['public']['Tables']['subscribers']['Row'];

function rowToSubscriber(row: SubscriberRow): Subscriber {
  return Subscriber.create({
    id: row.id,
    publisherId: row.publisher_id,
    contactHandle: row.contact_handle,
    status: row.status as SubscriptionStatus,
  });
}

export class SupabaseSubscriberRepository implements ISubscriberRepository {
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
  }

  async save(subscriber: Subscriber): Promise<void> {
    const { error } = await this.client.from('subscribers').upsert({
      id: subscriber.id,
      publisher_id: subscriber.publisherId,
      contact_handle: subscriber.contactHandle,
      status: subscriber.status,
    });
    if (error != null) throw new Error(error.message);
  }

  async findActiveByPublisher(publisherId: string): Promise<Subscriber[]> {
    const { data, error } = await this.client
      .from('subscribers')
      .select('*')
      .eq('publisher_id', publisherId)
      .eq('status', 'active');
    if (error != null) throw new Error(error.message);
    return data.map(rowToSubscriber);
  }

  async findById(id: string): Promise<Subscriber | null> {
    const { data, error } = await this.client
      .from('subscribers')
      .select('*')
      .eq('id', id)
      .single();
    if (error != null) return null;
    return rowToSubscriber(data);
  }
}
