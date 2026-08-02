// Hits the real Supabase project. Skipped automatically when
// EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are not set (e.g. in CI), so it never
// breaks the normal suite. Run locally with: npm run test:integration
//
// Verifies the parts that unit tests can't: that the publisher_config table
// exists and that the anon RLS policies allow the insert/select/update that
// save() (upsert) and findByPublisher() perform.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import { SupabasePublisherConfigRepository } from './SupabasePublisherConfigRepository';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const supabaseKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const RUN = supabaseUrl && supabaseKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// A dedicated row so the test never collides with real publisher data.
const TEST_PUBLISHER_ID = 'integration-test-publisher';

describeIf(RUN)('SupabasePublisherConfigRepository (integration)', () => {
  function makeRepo(): SupabasePublisherConfigRepository {
    return new SupabasePublisherConfigRepository(
      createClient(supabaseUrl!, supabaseKey!, { auth: { persistSession: false } }),
    );
  }

  it('inserts a config and reads it back (insert + select policies)', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.save(PublisherConfig.create({
      publisherId: TEST_PUBLISHER_ID,
      frequency: 'weekly',
      photosPerPost: 5,
      requireApproval: true,
    }));

    const loaded = await repo.findByPublisher(TEST_PUBLISHER_ID);
    expect(loaded).not.toBeNull();
    expect(loaded?.publisherId).toBe(TEST_PUBLISHER_ID);
    expect(loaded?.frequency).toBe('weekly');
    expect(loaded?.photosPerPost).toBe(5);
    expect(loaded?.requireApproval).toBe(true);
  });

  it('overwrites the existing row on re-save (update policy)', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.save(PublisherConfig.create({
      publisherId: TEST_PUBLISHER_ID,
      frequency: 'monthly',
      photosPerPost: 15,
      requireApproval: false,
    }));

    const loaded = await repo.findByPublisher(TEST_PUBLISHER_ID);
    expect(loaded?.frequency).toBe('monthly');
    expect(loaded?.photosPerPost).toBe(15);
    expect(loaded?.requireApproval).toBe(false);
  });

  it('returns null for a publisher with no config', async (): Promise<void> => {
    const repo = makeRepo();
    const loaded = await repo.findByPublisher('integration-test-nonexistent');
    expect(loaded).toBeNull();
  });
});
