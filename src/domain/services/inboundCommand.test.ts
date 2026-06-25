import { parseInboundCommand } from './inboundCommand';

describe('parseInboundCommand — STOP / opt-out', () => {
  it.each(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])(
    'treats "%s" as a stop command',
    keyword => {
      expect(parseInboundCommand(keyword)).toEqual({ kind: 'stop' });
    },
  );

  it.each(['stop', 'Stop', 'StOp', 'unsubscribe', 'Unsubscribe'])(
    'is case-insensitive: "%s" is a stop command',
    keyword => {
      expect(parseInboundCommand(keyword)).toEqual({ kind: 'stop' });
    },
  );

  it('ignores surrounding whitespace and newlines', () => {
    expect(parseInboundCommand('  STOP  ')).toEqual({ kind: 'stop' });
    expect(parseInboundCommand('STOP\n')).toEqual({ kind: 'stop' });
  });
});

describe('parseInboundCommand — START / opt-in', () => {
  it.each(['START', 'UNSTOP', 'YES', 'SUBSCRIBE'])(
    'treats "%s" as a start command',
    keyword => {
      expect(parseInboundCommand(keyword)).toEqual({ kind: 'start' });
    },
  );

  it.each(['start', 'Start', 'sTaRt'])('is case-insensitive: "%s" is a start command', keyword => {
    expect(parseInboundCommand(keyword)).toEqual({ kind: 'start' });
  });
});

describe('parseInboundCommand — JOIN handshake', () => {
  it('parses "JOIN <publisherId>" and extracts the id', () => {
    expect(parseInboundCommand('JOIN abc-123')).toEqual({ kind: 'join', publisherId: 'abc-123' });
  });

  it('matches JOIN case-insensitively but preserves the publisher id case', () => {
    expect(parseInboundCommand('join AbC-123')).toEqual({ kind: 'join', publisherId: 'AbC-123' });
  });

  it('collapses extra whitespace between JOIN and the id', () => {
    expect(parseInboundCommand('JOIN    xyz')).toEqual({ kind: 'join', publisherId: 'xyz' });
  });

  it('is not a join when the id is missing', () => {
    expect(parseInboundCommand('JOIN')).toEqual({ kind: 'unknown' });
  });

  it('is not a join when there are extra words after the id', () => {
    expect(parseInboundCommand('JOIN abc please')).toEqual({ kind: 'unknown' });
  });
});

describe('parseInboundCommand — unknown / noise', () => {
  it.each(['', '   ', 'hello', 'stop please', 'I want to stop', 'restart'])(
    'returns unknown for "%s"',
    text => {
      expect(parseInboundCommand(text)).toEqual({ kind: 'unknown' });
    },
  );

  it('does not treat a stop keyword embedded in a sentence as a command', () => {
    expect(parseInboundCommand('please STOP sending')).toEqual({ kind: 'unknown' });
  });

  it('handles a null-ish body without throwing', () => {
    expect(parseInboundCommand(undefined as unknown as string)).toEqual({ kind: 'unknown' });
  });
});
