// Parses the body of an inbound WhatsApp message into the command it
// represents. Twilio delivers every reply a subscriber sends to our number to
// the same webhook, so this is the single place that decides what a message
// *means* — STOP/START opt-out keywords, the JOIN handshake, or noise we ignore.
//
// Keyword sets follow the standard messaging-compliance vocabulary Twilio's own
// Advanced Opt-Out uses, so subscribers can use whichever word they expect.

export type InboundCommand =
  | { kind: 'stop' }
  | { kind: 'start' }
  | { kind: 'join'; publisherId: string }
  | { kind: 'unknown' };

// Single-word opt-out keywords (case-insensitive).
const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);

// Single-word opt-in / resubscribe keywords (case-insensitive).
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE']);

export function parseInboundCommand(rawBody: string | null | undefined): InboundCommand {
  // Collapse surrounding/internal whitespace so " stop ", "STOP\n", and
  // "JOIN   abc" all normalise cleanly.
  const normalized = (rawBody ?? '').trim().replace(/\s+/g, ' ');
  if (normalized === '') return { kind: 'unknown' };

  const upper = normalized.toUpperCase();
  if (STOP_KEYWORDS.has(upper)) return { kind: 'stop' };
  if (START_KEYWORDS.has(upper)) return { kind: 'start' };

  // JOIN <publisherId> — keep the publisherId in its original case (the keyword
  // match is case-insensitive, the id is not).
  const joinMatch = /^JOIN (\S+)$/i.exec(normalized);
  if (joinMatch) return { kind: 'join', publisherId: joinMatch[1] as string };

  return { kind: 'unknown' };
}
