import { assertEquals } from '@std/assert';
import { publisherDisplayName, publisherIdentity, resolvePublisherName } from './publisher.ts';
// deno-lint-ignore no-explicit-any -- structural stand-in for the supabase-js client
type AnyClient = any;

Deno.test('publisherDisplayName — profile name wins, then metadata, then email, then generic', () => {
  assertEquals(publisherDisplayName('Traveler Uri', { display_name: 'Uri Shiber' }, 'uri@x.com'), 'Traveler Uri');
  assertEquals(publisherDisplayName('', { display_name: 'Uri Shiber' }, 'uri@example.com'), 'Uri Shiber');
  assertEquals(publisherDisplayName('', { full_name: 'Uri Shiber' }, 'uri@example.com'), 'Uri Shiber');
  assertEquals(publisherDisplayName('', { display_name: '' }, 'uri@example.com'), 'uri');
  assertEquals(publisherDisplayName('', null, 'uri@example.com'), 'uri');
  assertEquals(publisherDisplayName('', null, null), 'your publisher');
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

Deno.test('resolvePublisherName — uses the app-chosen profile name, not the generic label', async () => {
  // The publisher signed up by phone: no email, no auth metadata. Their name
  // only exists in publisher_profile, which is what the welcome must say.
  const client = mockClient({ display_name: 'Traveler Uri' }, { user_metadata: {}, email: null });
  assertEquals(await resolvePublisherName(client, 'p1'), 'Traveler Uri');
});

Deno.test('resolvePublisherName — falls back to auth metadata, then email, then generic', async () => {
  const meta = mockClient(null, { user_metadata: { display_name: 'Uri S' }, email: 'uri@example.com' });
  assertEquals(await resolvePublisherName(meta, 'p1'), 'Uri S');

  const email = mockClient({ display_name: '' }, { user_metadata: {}, email: 'uri@example.com' });
  assertEquals(await resolvePublisherName(email, 'p1'), 'uri');

  const bare = mockClient(null, { user_metadata: {}, email: null });
  assertEquals(await resolvePublisherName(bare, 'p1'), 'your publisher');
});

Deno.test('resolvePublisherName — null when the publisher does not exist', async () => {
  assertEquals(await resolvePublisherName(mockClient(null, null), 'nope'), null);
});

Deno.test('resolvePublisherName — profile name still wins when the auth lookup throws', async () => {
  const client: AnyClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { display_name: 'Traveler Uri' } }) }),
      }),
    }),
    auth: { admin: { getUserById: () => Promise.reject(new Error('boom')) } },
  };
  assertEquals(await resolvePublisherName(client, 'p1'), 'Traveler Uri');
});

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
