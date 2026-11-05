import { SupabasePublisherConfigRepository, SIGNED_OUT_SAVE_MESSAGE } from './SupabasePublisherConfigRepository';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { SELECTABLE_CATEGORIES } from '../../domain/entities/PhotoClassification';
import type { AppSupabaseClient } from '../supabase/types';

const RLS_DENIED = { code: '42501', message: 'new row violates row-level security policy for table "publisher_config"' };

function repoWith(upsertError: unknown, session: unknown): SupabasePublisherConfigRepository {
  const client = {
    from: () => ({ upsert: () => Promise.resolve({ error: upsertError }) }),
    auth: { getSession: () => Promise.resolve({ data: { session } }) },
  };
  return new SupabasePublisherConfigRepository(client as unknown as AppSupabaseClient);
}

const config = PublisherConfig.create({
  publisherId: 'user-1',
  frequency: 'weekly',
  photosPerPost: 5,
  requireApproval: false,
  notifyDayOfWeek: 1,
  notifyTime: '09:00',
  enabledCategories: [SELECTABLE_CATEGORIES[0]!],
  minQuality: 0.5,
  timezone: 'UTC',
  expoPushToken: '',
  photosOfMe: 'off',
});

describe('SupabasePublisherConfigRepository.save', () => {
  it('resolves when the upsert succeeds', async () => {
    await expect(repoWith(null, { user: { id: 'user-1' } }).save(config)).resolves.toBeUndefined();
  });

  // A debounced settings write can land after sign-out; the request then runs
  // as anon and RLS denies it. That is the user leaving, not an ownership bug.
  it('names an RLS denial with no session as a signed-out save', async () => {
    await expect(repoWith(RLS_DENIED, null).save(config)).rejects.toThrow(SIGNED_OUT_SAVE_MESSAGE);
  });

  it('names an RLS denial for a different signed-in user as a signed-out save', async () => {
    await expect(repoWith(RLS_DENIED, { user: { id: 'someone-else' } }).save(config)).rejects.toThrow(
      SIGNED_OUT_SAVE_MESSAGE,
    );
  });

  it('keeps the raw RLS error when the right user is signed in — that is a real bug', async () => {
    await expect(repoWith(RLS_DENIED, { user: { id: 'user-1' } }).save(config)).rejects.toThrow(
      /row-level security/,
    );
  });
});
