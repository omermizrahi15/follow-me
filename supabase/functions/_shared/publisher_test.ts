import { assertEquals } from '@std/assert';
import { publisherDisplayName, publisherIdentity } from './publisher.ts';
// deno-lint-ignore no-explicit-any -- structural stand-in for the supabase-js client
type AnyClient = any;

Deno.test('publisherDisplayName — metadata name wins, then email local-part, then generic', () => {
  assertEquals(publisherDisplayName({ display_name: 'Uri Shiber' }, 'uri@example.com'), 'Uri Shiber');
  assertEquals(publisherDisplayName({ display_name: '' }, 'uri@example.com'), 'uri');
  assertEquals(publisherDisplayName(null, 'uri@example.com'), 'uri');
  assertEquals(publisherDisplayName(null, null), 'your publisher');
});

/** Minimal supabase-js stand-in: a publisher_profile row + an auth user. */
function mockClient(profile: { display_name?: string } | null, user: unknown): AnyClient {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profile }) }) }),
    }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user } }) } },
  };
}

Deno.test('publisherIdentity — prefers the profile display name and returns the phone', async () => {
  const client = mockClient({ display_name: 'Traveler Uri' }, { user_metadata: { full_name: 'Uri S' }, phone: '+1555' });
  assertEquals(await publisherIdentity(client, 'p1'), { name: 'Traveler Uri', phone: '+1555' });
});

Deno.test('publisherIdentity — falls back to auth full_name, then a generic label', async () => {
  const withFullName = mockClient(null, { user_metadata: { full_name: 'Uri S' }, phone: undefined });
  assertEquals(await publisherIdentity(withFullName, 'p1'), { name: 'Uri S', phone: undefined });

  const bare = mockClient({ display_name: '' }, { user_metadata: {}, phone: undefined });
  assertEquals(await publisherIdentity(bare, 'p1'), { name: 'Your friend', phone: undefined });
});
