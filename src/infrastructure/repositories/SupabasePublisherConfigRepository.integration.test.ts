// Hits the real Supabase project. Skipped automatically when the creds are not
// set (e.g. in CI), so it never breaks the normal suite. Run locally with:
//   AUTH_TEST_PHONE=... AUTH_TEST_OTP=... npm run test:integration
//
// Verifies the parts that unit tests can't: that the publisher_config table
// exists and that the owner-only RLS policies (20240031) allow the
// insert/select/update that save() (upsert) and findByPublisher() perform.
// Since those policies match `auth.uid()`, the repository is driven by a
// signed-in client and the test rows are keyed on that user's id — an
// arbitrary publisher id would now be rejected by the policy's WITH CHECK.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import type { AppSupabaseClient } from '../supabase/types';
import { SupabasePublisherConfigRepository } from './SupabasePublisherConfigRepository';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { signedInClient } from '../supabase/testing/clients';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const supabaseKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const testPhone = process.env['AUTH_TEST_PHONE'] as string | undefined;
const testOtp = process.env['AUTH_TEST_OTP'] as string | undefined;
const RUN = supabaseUrl && supabaseKey && testPhone && testOtp;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

describeIf(RUN)('SupabasePublisherConfigRepository (integration)', () => {
  let client: AppSupabaseClient;
  let publisherId: string;

  beforeAll(async (): Promise<void> => {
    ({ client, userId: publisherId } = await signedInClient(
      supabaseUrl!, supabaseKey!, testPhone!, testOtp!,
    ));
  });

  afterAll(async (): Promise<void> => {
    await client.from('publisher_config').delete().eq('publisher_id', publisherId);
    await client.auth.signOut();
  });

  function makeRepo(): SupabasePublisherConfigRepository {
    return new SupabasePublisherConfigRepository(client);
  }

  it('inserts a config and reads it back (insert + select policies)', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.save(PublisherConfig.create({
      publisherId,
      frequency: 'weekly',
      photosPerPost: 5,
      requireApproval: true,
    }));

    const loaded = await repo.findByPublisher(publisherId);
    expect(loaded).not.toBeNull();
    expect(loaded?.publisherId).toBe(publisherId);
    expect(loaded?.frequency).toBe('weekly');
    expect(loaded?.photosPerPost).toBe(5);
    expect(loaded?.requireApproval).toBe(true);
  });

  it('overwrites the existing row on re-save (update policy)', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.save(PublisherConfig.create({
      publisherId,
      frequency: 'monthly',
      photosPerPost: 15,
      requireApproval: false,
    }));

    const loaded = await repo.findByPublisher(publisherId);
    expect(loaded?.frequency).toBe('monthly');
    expect(loaded?.photosPerPost).toBe(15);
    expect(loaded?.requireApproval).toBe(false);
  });

  it('returns null for a publisher with no config', async (): Promise<void> => {
    const repo = makeRepo();
    const loaded = await repo.findByPublisher('integration-test-nonexistent');
    expect(loaded).toBeNull();
  });

  it('rejects writing a config owned by someone else (policy WITH CHECK)', async (): Promise<void> => {
    const repo = makeRepo();
    await expect(repo.save(PublisherConfig.create({
      publisherId: 'integration-test-someone-else',
      frequency: 'weekly',
      photosPerPost: 5,
      requireApproval: true,
    }))).rejects.toThrow();
  });
});
