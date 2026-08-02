import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database';
import type { ISubscriberRepository } from '../../domain/interfaces';
import { Subscriber } from '../../domain/entities/Subscriber';
import type { SubscriptionStatus } from '../../domain/entities/Subscriber';

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
  constructor(private readonly client: SupabaseClient<Database>) {}

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

  async findByPublisher(publisherId: string): Promise<Subscriber[]> {
    const { data, error } = await this.client
      .from('subscribers')
      .select('*')
      .eq('publisher_id', publisherId);
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

  async findByPublisherAndContact(publisherId: string, contactHandle: string): Promise<Subscriber | null> {
    const { data, error } = await this.client
      .from('subscribers')
      .select('*')
      .eq('publisher_id', publisherId)
      .eq('contact_handle', contactHandle)
      .single();
    if (error != null) return null;
    return rowToSubscriber(data);
  }

  async findByContactHandle(contactHandle: string): Promise<Subscriber[]> {
    const { data, error } = await this.client
      .from('subscribers')
      .select('*')
      .eq('contact_handle', contactHandle);
    if (error != null) throw new Error(error.message);
    return data.map(rowToSubscriber);
  }
}
