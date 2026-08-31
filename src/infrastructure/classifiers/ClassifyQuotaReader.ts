import type { AiUsageSnapshot, ProviderLimits, ProviderLimitWindow } from '../../domain/entities/AiUsage';
import type { IAiUsageReader } from '../../domain/interfaces';
import { appFetch } from '../http/appFetch';

/**
 * Reads the day's classify budget from the classify-photos Edge Function.
 *
 * Same URL and same auth as the POST that spends the budget — `GET` on that
 * endpoint answers with the caller's own count and the server's ceiling. Going
 * to the table directly would be shorter and wrong: `classify_quota` is
 * service-role only, and the ceiling is an env var of the function, so the
 * function is the one place that knows both halves.
 */
export class ClassifyQuotaReader implements IAiUsageReader {
  constructor(
    private readonly functionUrl: string,
    private readonly authKey: string,
    /**
     * Supplies the signed-in user's JWT. The endpoint rejects the bare anon key
     * on a POST and on this GET alike — it is the token that says whose row to
     * read. Absent (tests, integration harness) falls back to the anon key.
     */
    private readonly getAccessToken?: () => Promise<string | null>,
  ) {}

  async read(): Promise<AiUsageSnapshot> {
    const token = await this.getAccessToken?.().catch(() => null);
    const bearer = this.getAccessToken == null ? this.authKey : token;
    // A missing session is reported, never smoothed into a snapshot: every
    // "unknown" this could invent — zero used, zero allowed — is also a real
    // state the bar draws differently.
    if (bearer == null) throw new Error('not signed in — cannot read the AI budget');

    const res = await appFetch(this.functionUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, apikey: this.authKey },
    });
    if (!res.ok) throw new Error(`classify-photos usage returned ${res.status}`);

    const body = (await res.json().catch(() => null)) as {
      used?: unknown;
      limit?: unknown;
      day?: unknown;
      provider?: unknown;
      providers?: unknown;
    } | null;

    // A deployment that predates the GET handler answers 405 with its own JSON,
    // so a well-formed body is not enough — the count has to be there. `limit`
    // is deliberately NOT required: null is its normal value now (we impose no
    // ceiling of our own), and demanding a number would reject the honest
    // answer while accepting the invented one.
    if (!Number.isFinite(body?.used)) {
      throw new Error('classify-photos returned an unreadable usage body');
    }

    const provider = parseProviderLimits(body?.provider);
    // A deployment that predates the list still answers with the singular
    // field, and reading that as "no providers" would blank the panel on
    // exactly the deployment whose limits someone is trying to read.
    const providers = Array.isArray(body?.providers)
      ? body.providers.map(parseProviderLimits).filter((p): p is ProviderLimits => p != null)
      : provider != null
        ? [provider]
        : [];

    return {
      used: Number(body?.used),
      limit: Number.isFinite(body?.limit) ? Number(body?.limit) : null,
      day: typeof body?.day === 'string' ? body.day : '',
      provider,
      providers,
    };
  }
}

/** One `{ limit, remaining, resetSeconds }` from the wire, or null. */
function parseWindow(raw: unknown): ProviderLimitWindow | null {
  if (raw == null || typeof raw !== 'object') return null;
  const w = raw as { limit?: unknown; remaining?: unknown; resetSeconds?: unknown };
  if (!Number.isFinite(w.limit) || !Number.isFinite(w.remaining)) return null;
  return {
    limit: Number(w.limit),
    remaining: Number(w.remaining),
    resetSeconds: Number.isFinite(w.resetSeconds) ? Number(w.resetSeconds) : null,
  };
}

/**
 * The provider's own ceilings out of the response, or null.
 *
 * Every branch here fails to null rather than to zeros. "The provider has not
 * told us" and "you have none left" look identical in a zeroed shape and mean
 * opposite things, and this whole change exists because a number that stood in
 * for a fact got believed.
 */
function parseProviderLimits(raw: unknown): ProviderLimits | null {
  if (raw == null || typeof raw !== 'object') return null;
  const p = raw as {
    provider?: unknown;
    model?: unknown;
    requests?: unknown;
    tokens?: unknown;
    observedAt?: unknown;
  };
  if (typeof p.provider !== 'string' || typeof p.model !== 'string') return null;
  return {
    provider: p.provider,
    model: p.model,
    requests: parseWindow(p.requests),
    tokens: parseWindow(p.tokens),
    observedAt: Number.isFinite(p.observedAt) ? Number(p.observedAt) : 0,
  };
}
