import { classifyFailure, describeFailure } from './networkError';

import type { ConnectionStatus } from '../entities/Connectivity';
import type { FailureCopy } from './networkError';

const describeWith = (error: unknown, connection: ConnectionStatus = 'online'): FailureCopy =>
  describeFailure({ error, connection, title: 'Couldn’t load your posts' });

describe('classifyFailure', () => {
  it('reads React Native’s network error as a lost connection', () => {
    expect(classifyFailure(new TypeError('Network request failed'))).toBe('offline');
  });

  it('reads the browser/Deno wording too', () => {
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('offline');
  });

  it('recognises our own timeout', () => {
    const timeout = Object.assign(new Error('Request timed out after 15000ms: /x'), {
      name: 'RequestTimeoutError',
    });
    expect(classifyFailure(timeout)).toBe('timeout');
  });

  it('recognises an aborted request as a timeout', () => {
    expect(classifyFailure(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe('timeout');
  });

  it('reads a 5xx as the server’s problem', () => {
    expect(classifyFailure(new Error('send-post failed (503): upstream down'))).toBe('server');
  });

  it('reads a 4xx as a refusal — the request was heard and declined', () => {
    expect(classifyFailure(new Error('Post failed (403): row-level security'))).toBe('refused');
  });

  it('does not mistake a number in the message for a status', () => {
    expect(classifyFailure(new Error('could not decode photo 503'))).toBe('unknown');
  });

  it('handles being given something that is not an error at all', () => {
    expect(classifyFailure('nope')).toBe('unknown');
    expect(classifyFailure(null)).toBe('unknown');
  });
});

describe('describeFailure', () => {
  it('keeps the caller’s title — the user cares what failed, not how', () => {
    expect(describeWith(new Error('boom')).title).toBe('Couldn’t load your posts');
  });

  it('blames the connection when the app knows it is offline, whatever the error said', () => {
    // A request made as the signal died can fail in any number of ways. If we
    // already know there is no connection, that is the useful thing to say.
    const copy = describeWith(new Error('Post failed (500): internal'), 'offline');
    expect(copy.hint).toContain('offline');
  });

  it('says a captive-network failure is the network, not the app', () => {
    const copy = describeWith(new TypeError('Network request failed'), 'unreachable');
    expect(copy.hint.toLowerCase()).toContain('sign in');
  });

  it('tells a server error apart from a connection problem', () => {
    // The distinction that matters: one is worth moving somewhere with signal,
    // the other is worth waiting out. Saying "check your connection" for a 500
    // sends the user to fix something that was never broken.
    const copy = describeWith(new Error('failed (502): bad gateway'));
    expect(copy.hint).toContain('our end');
    expect(copy.hint).not.toContain('offline');
  });

  it('says a timeout was slowness, not a refusal', () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'RequestTimeoutError' });
    expect(describeWith(timeout).hint.toLowerCase()).toContain('too slow');
  });

  it('passes on a refusal’s own words, which say more than a generic message', () => {
    const copy = describeWith(new Error('This invite link is invalid or has expired.'));
    expect(copy.hint).toBe('This invite link is invalid or has expired.');
  });

  it('does not show the user a stack-trace-shaped message', () => {
    const copy = describeWith(new Error('TypeError: undefined is not an object (evaluating x.y)'));
    expect(copy.hint).not.toContain('evaluating');
  });

  it('always offers a way to try again', () => {
    expect(describeWith(new Error('boom')).action).toBe('Try again');
    expect(describeWith(new Error('boom'), 'offline').action).toBe('Try again');
  });
});
