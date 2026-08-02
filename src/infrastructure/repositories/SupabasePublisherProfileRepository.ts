import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database';
import type { IPublisherProfileRepository } from '../../domain/interfaces';
import { PublisherProfile } from '../../domain/entities/PublisherProfile';

type ProfileRow = Database['public']['Tables']['publisher_profile']['Row'];

/** "2026-06-14" -> local midnight on that day (never UTC, which can shift it a day). */
function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Local calendar day -> "YYYY-MM-DD", matching the column's `date` type. */
function formatLocalDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rowToProfile(row: ProfileRow): PublisherProfile {
  return PublisherProfile.create({
    publisherId: row.publisher_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    // Stored as a bare `date` (no time, no zone): the trip started on a day,
    // not at an instant. Parsed as local midnight so it lines up with the
    // windows the backfill cuts.
    tripStartDate: row.trip_start_date != null ? parseLocalDate(row.trip_start_date) : null,
  });
}

export class SupabasePublisherProfileRepository implements IPublisherProfileRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async save(profile: PublisherProfile): Promise<void> {
    const { error } = await this.client.from('publisher_profile').upsert({
      publisher_id: profile.publisherId,
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl,
      trip_start_date: profile.tripStartDate != null ? formatLocalDate(profile.tripStartDate) : null,
    });
    if (error != null) throw new Error(error.message);
  }

  async findByPublisher(publisherId: string): Promise<PublisherProfile | null> {
    const { data, error } = await this.client
      .from('publisher_profile')
      .select('*')
      .eq('publisher_id', publisherId)
      .single();
    if (error != null) return null;
    return rowToProfile(data);
  }
}
