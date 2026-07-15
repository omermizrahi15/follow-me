import { assert, assertEquals } from '@std/assert';
import {
  type DbClient,
  isFailureStatus,
  isUnreachableErrorCode,
  logAcceptedSend,
  logRejectedSend,
  markSubscriberUnreachable,
} from './messageLog.ts';

interface Insert { table: string; row: Record<string, unknown>; }
interface Update { table: string; values: Record<string, unknown>; filters: [string, string][]; }

/** In-memory DbClient matching the injected supabase-js slice. */
function mockDb(insertError: { message: string } | null = null): {
  db: DbClient;
  inserts: Insert[];
  updates: Update[];
} {
  const inserts: Insert[] = [];
  const updates: Update[] = [];
  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: insertError });
        },
        update(values: Record<string, unknown>) {
          const rec: Update = { table, values, filters: [] };
          updates.push(rec);
          const filter = {
            eq(column: string, value: string) {
              rec.filters.push([column, value]);
              return filter;
            },
            then<T>(onfulfilled: (r: { error: { message: string } | null }) => T): Promise<T> {
              return Promise.resolve({ error: null }).then(onfulfilled);
            },
          };
          return filter;
        },
      };
    },
  };
  return { db: db as unknown as DbClient, inserts, updates };
}

// ── classification helpers ──────────────────────────────────────────────────

Deno.test('isFailureStatus — only failed/undelivered are terminal failures', () => {
  assert(isFailureStatus('failed'));
  assert(isFailureStatus('undelivered'));
  for (const s of ['queued', 'sent', 'delivered', 'read']) assert(!isFailureStatus(s), s);
});

Deno.test('isUnreachableErrorCode — flags recipient-level codes only', () => {
  for (const c of [21211, 21610, 21614, 63003, 63024]) assert(isUnreachableErrorCode(c), String(c));
  for (const c of [63016, 20429, 0]) assert(!isUnreachableErrorCode(c), String(c)); // session/rate errors are not
  assert(!isUnreachableErrorCode(null));
});

// ── writes (injected mock db) ───────────────────────────────────────────────

Deno.test('logAcceptedSend — inserts a message_logs row, defaulting status to queued', async () => {
  const { db, inserts } = mockDb();
  await logAcceptedSend(db, { sid: 'SM1', publisherId: 'p1', contactHandle: '+1' });
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].table, 'message_logs');
  assertEquals(inserts[0].row.message_sid, 'SM1');
  assertEquals(inserts[0].row.publisher_id, 'p1');
  assertEquals(inserts[0].row.contact_handle, '+1');
  assertEquals(inserts[0].row.status, 'queued');
});

Deno.test('logAcceptedSend — honours an explicit initial status', async () => {
  const { db, inserts } = mockDb();
  await logAcceptedSend(db, { sid: 'SM2', publisherId: 'p', contactHandle: '+1', status: 'sent' });
  assertEquals(inserts[0].row.status, 'sent');
});

Deno.test('logRejectedSend — synthesizes a SID, marks failed, records code + truncated detail', async () => {
  const { db, inserts } = mockDb();
  const longMessage = 'x'.repeat(900);
  await logRejectedSend(db, {
    publisherId: 'p',
    contactHandle: '+1',
    error: { message: longMessage, status: 400, twilioCode: 21211 },
  });
  const row = inserts[0].row;
  assert(String(row.message_sid).startsWith('rejected-'));
  assertEquals(row.status, 'failed');
  assertEquals(row.error_code, '21211');
  assertEquals(String(row.detail).length, 500);
});

Deno.test('logRejectedSend — falls back to HTTP status for the code when Twilio code is absent', async () => {
  const { db, inserts } = mockDb();
  await logRejectedSend(db, { publisherId: 'p', contactHandle: '+1', error: { message: 'network', status: null, twilioCode: null } });
  assertEquals(inserts[0].row.error_code, '');
});

Deno.test('markSubscriberUnreachable — updates only active rows for the (publisher, contact)', async () => {
  const { db, updates } = mockDb();
  await markSubscriberUnreachable(db, 'pub1', '+15550001111');
  assertEquals(updates.length, 1);
  assertEquals(updates[0].table, 'subscribers');
  assertEquals(updates[0].values, { status: 'unreachable' });
  assertEquals(updates[0].filters, [
    ['publisher_id', 'pub1'],
    ['contact_handle', '+15550001111'],
    ['status', 'active'],
  ]);
});

Deno.test('logAcceptedSend — a DB error is swallowed (best-effort, never breaks delivery)', async () => {
  const { db } = mockDb({ message: 'insert boom' });
  // Should not throw.
  await logAcceptedSend(db, { sid: 'SM', publisherId: 'p', contactHandle: '+1' });
});
