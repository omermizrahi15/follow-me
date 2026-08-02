import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../infrastructure/supabase/database';

/** What a repository's query built, plus the result the fake resolves with. */
export interface RecordedQuery {
  /** Set before the call under test to control what the query resolves with. */
  result: { data: unknown; error: unknown };
  table: string | null;
  eqCalls: Array<[string, unknown]>;
  inCalls: Array<[string, unknown]>;
}

/**
 * A Supabase client stand-in that records the query a repository builds and
 * resolves it with `recorded.result`.
 *
 * Repositories take their client by injection (issue #115), so these tests hand
 * one over rather than mocking the `@supabase/supabase-js` module.
 */
export function recordingClient(): { client: SupabaseClient<Database>; recorded: RecordedQuery } {
  const recorded: RecordedQuery = {
    result: { data: [], error: null },
    table: null,
    eqCalls: [],
    inCalls: [],
  };

  interface QueryBuilder {
    select: () => QueryBuilder;
    eq: (column: string, value: unknown) => QueryBuilder;
    in: (column: string, values: unknown) => QueryBuilder;
    single: () => QueryBuilder;
    then: (resolve: (v: unknown) => void) => void;
  }
  const builder: QueryBuilder = {
    select: () => builder,
    eq: (column, value) => {
      recorded.eqCalls.push([column, value]);
      return builder;
    },
    in: (column, values) => {
      recorded.inCalls.push([column, values]);
      return builder;
    },
    single: () => builder,
    then: (resolve): void => resolve(recorded.result),
  };

  const client = {
    from: (table: string) => {
      recorded.table = table;
      return builder;
    },
  } as unknown as SupabaseClient<Database>;

  return { client, recorded };
}
