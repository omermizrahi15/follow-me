import { connectivityCopy, isUsable, statusFromReading } from './connectivityCopy';

describe('statusFromReading', () => {
  it('is online when a network is up and traffic gets through', () => {
    expect(statusFromReading({ isConnected: true, isInternetReachable: true })).toBe('online');
  });

  it('is offline when no network is attached', () => {
    expect(statusFromReading({ isConnected: false, isInternetReachable: false })).toBe('offline');
  });

  it('is offline even if the platform still claims the internet is reachable', () => {
    // A stale reachability probe outliving the interface it was measured on.
    // No interface means nothing is getting out, whatever the probe remembers.
    expect(statusFromReading({ isConnected: false, isInternetReachable: true })).toBe('offline');
  });

  it('is unreachable on a network that is not passing traffic', () => {
    // Hotel wifi before you sign in: connected, full bars, nothing gets out.
    expect(statusFromReading({ isConnected: true, isInternetReachable: false })).toBe('unreachable');
  });

  it('reads a pending reachability probe as online, not unreachable', () => {
    // The first reading after launch always has a null probe. Calling that
    // "unreachable" would flash a captive-portal banner at every cold start.
    expect(statusFromReading({ isConnected: true, isInternetReachable: null })).toBe('online');
  });

  it('is unknown while the platform has not reported a connection either way', () => {
    expect(statusFromReading({ isConnected: null, isInternetReachable: null })).toBe('unknown');
  });
});

describe('isUsable', () => {
  it('is true when online', () => {
    expect(isUsable('online')).toBe(true);
  });

  it('is true when unknown — an unmeasured connection is not a broken one', () => {
    expect(isUsable('unknown')).toBe(true);
  });

  it('is false when offline or unreachable', () => {
    expect(isUsable('offline')).toBe(false);
    expect(isUsable('unreachable')).toBe(false);
  });
});

describe('connectivityCopy', () => {
  it('says nothing when the connection is working', () => {
    expect(connectivityCopy('online')).toBeNull();
    expect(connectivityCopy('unknown')).toBeNull();
  });

  it('names the two failures differently — they need different things from the user', () => {
    const offline = connectivityCopy('offline');
    const unreachable = connectivityCopy('unreachable');
    expect(offline?.title).not.toBe(unreachable?.title);
  });

  it('tells an offline user the app will pick up again by itself', () => {
    const copy = connectivityCopy('offline');
    expect(copy?.title).toBe('No connection');
    expect(copy?.hint).toContain('back online');
  });

  it('points an unreachable user at the sign-in page that is blocking them', () => {
    const copy = connectivityCopy('unreachable');
    expect(copy?.hint.toLowerCase()).toContain('sign in');
  });

  it('offers a retry on both failures, since a fresh check is all the user can do', () => {
    expect(connectivityCopy('offline')?.action).toBe('Retry');
    expect(connectivityCopy('unreachable')?.action).toBe('Retry');
  });
});
