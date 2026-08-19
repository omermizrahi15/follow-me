import type { ConnectionStatus } from '../entities/Connectivity';
import { isUsable } from './connectivityCopy';

/**
 * Saying what went wrong in words the user can act on (issue #145).
 *
 * Every failure in the app used to arrive as the same "please try again", which
 * is the one message that is never useful: a publisher on a train and a
 * publisher hitting a broken server were told the same thing, and neither could
 * tell which they were. These four kinds each call for something different —
 * move, wait, retry, or stop — so they are worth telling apart.
 */

export type FailureKind =
  /** The request never left, or the connection died under it. */
  | 'offline'
  /** It left, and nothing came back in time. */
  | 'timeout'
  /** The server answered, and the answer was that it is broken. */
  | 'server'
  /** The server heard it and said no — bad input, no permission, gone. */
  | 'refused'
  | 'unknown';

/** Matches "(503)" as a status the way our error messages format it. */
const STATUS_PATTERN = /\((\d{3})\)/;

const OFFLINE_PATTERNS = [
  /network request failed/i, // React Native
  /failed to fetch/i, // browsers, Deno
  /network error/i,
  /connection (refused|reset|closed)/i,
  /unable to resolve host/i,
];

export function classifyFailure(error: unknown): FailureKind {
  if (!(error instanceof Error)) return 'unknown';

  // Our own deadline, and the abort it fires. Checked first: an aborted request
  // also surfaces as a network-ish failure, and the timeout is the real cause.
  if (error.name === 'RequestTimeoutError' || error.name === 'AbortError') return 'timeout';

  if (OFFLINE_PATTERNS.some(p => p.test(error.message))) return 'offline';

  const status = Number(STATUS_PATTERN.exec(error.message)?.[1] ?? NaN);
  if (status >= 500 && status <= 599) return 'server';
  if (status >= 400 && status <= 499) return 'refused';

  return 'unknown';
}

export interface FailureCopy {
  /** What failed, in the caller's words — "Couldn't load your posts". */
  title: string;
  /** Why, and what the user can do about it. */
  hint: string;
  /** Label for the retry affordance. Every failure gets one. */
  action: string;
}

/**
 * A message the user can read, from an error they cannot.
 *
 * The live connection status is taken as an input rather than inferred from the
 * error, and it wins: a request made as the signal died can fail in any number
 * of shapes, and when the app already knows there is no connection, that is the
 * one fact worth putting on screen.
 */
export function describeFailure(options: {
  error: unknown;
  connection: ConnectionStatus;
  /** What the user was trying to do — "Couldn't load your posts". */
  title: string;
}): FailureCopy {
  const { error, connection, title } = options;
  const action = 'Try again';

  if (connection === 'offline') {
    return {
      title,
      hint: 'You’re offline. This will work again as soon as you have a connection.',
      action,
    };
  }
  if (connection === 'unreachable') {
    return {
      title,
      hint: 'You’re connected, but nothing is getting through. Hotel and café wifi usually needs you to sign in first.',
      action,
    };
  }

  switch (classifyFailure(error)) {
    case 'offline':
      return { title, hint: 'The connection dropped before this finished.', action };
    case 'timeout':
      return {
        title,
        hint: 'The connection is too slow to finish this. It should work on a better signal.',
        action,
      };
    case 'server':
      return {
        title,
        // Worth saying plainly. Told to "check your connection", someone with a
        // perfectly good one goes looking for a fault that was never theirs.
        hint: 'Something went wrong on our end, not with your connection. Trying again usually works.',
        action,
      };
    case 'refused':
    case 'unknown':
      return { title, hint: userFacingMessage(error), action };
  }
}

/**
 * The error's own words when they were written for a person, and a generic
 * line when they were not. A refusal usually explains itself far better than
 * anything generic could ("This invite link is invalid or has expired") — but
 * a thrown TypeError from somewhere in the render tree explains nothing and
 * looks like a crash.
 */
function userFacingMessage(error: unknown): string {
  const fallback = 'Something went wrong. Trying again usually works.';
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (message === '') return fallback;
  // Developer-shaped: a stack frame, a type name, code punctuation.
  if (/^[A-Za-z]*Error:|\bundefined\b|\bnull\b|[{}<>]|\bat \w+\./.test(message)) return fallback;
  if (message.length > 140) return fallback;
  return message;
}

/** Convenience for callers that only need to know whether to bother trying. */
export function shouldAttempt(connection: ConnectionStatus): boolean {
  return isUsable(connection);
}
