import type { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';

export type JoinViewState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; contactHandle: string }
  | { status: 'error'; message: string };

/**
 * Extract the publisher id from a join URL path, e.g. "/join/abc-123" -> "abc-123".
 * Tolerates a trailing slash, query string, or hash. Returns null when absent.
 */
export function parsePublisherId(pathname: string): string | null {
  const match = pathname.match(/\/join\/([^/?#]+)/);
  const id = match?.[1];
  return id != null ? decodeURIComponent(id) : null;
}

/**
 * Validate and normalize a WhatsApp number to E.164 (e.g. "+972501234567").
 * Accepts common separators (spaces, dashes, parentheses) and an optional
 * leading "+". Returns null when the input isn't a plausible number.
 */
export function normalizeWhatsAppNumber(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Drives the web join page: validates input, runs the subscribe use case, and
 * maps the outcome to a view state the page can render. Framework-agnostic so
 * it can be unit-tested without a DOM.
 */
export class JoinController {
  constructor(
    private readonly subscribe: SubscribeUseCase,
    private readonly generateId: () => string,
  ) {}

  async submit(publisherId: string | null, rawPhone: string): Promise<JoinViewState> {
    if (publisherId == null || publisherId.length === 0) {
      return { status: 'error', message: 'This invite link is invalid or incomplete.' };
    }

    const contactHandle = normalizeWhatsAppNumber(rawPhone);
    if (contactHandle == null) {
      return {
        status: 'error',
        message: 'Enter a valid WhatsApp number, including country code (e.g. +972501234567).',
      };
    }

    try {
      await this.subscribe.subscribe({
        subscriberId: this.generateId(),
        publisherId,
        publisherName: '',
        contactHandle,
      });
      return { status: 'success', contactHandle };
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      return { status: 'error', message };
    }
  }
}
