import { ConnectivityMonitor, type TimerHandle } from './ConnectivityMonitor';
import type { ConnectionReading, IConnectivitySource } from '../../domain/interfaces';

const ONLINE: ConnectionReading = { isConnected: true, isInternetReachable: true };
const OFFLINE: ConnectionReading = { isConnected: false, isInternetReachable: false };
const CAPTIVE: ConnectionReading = { isConnected: true, isInternetReachable: false };
const UNSURE: ConnectionReading = { isConnected: null, isInternetReachable: null };

class FakeSource implements IConnectivitySource {
  reading: ConnectionReading = ONLINE;
  reads = 0;
  private readonly listeners = new Set<(reading: ConnectionReading) => void>();

  subscribe(listener: (reading: ConnectionReading) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  read(): Promise<ConnectionReading> {
    this.reads++;
    return Promise.resolve(this.reading);
  }

  emit(reading: ConnectionReading): void {
    this.reading = reading;
    for (const listener of this.listeners) listener(reading);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

/** setTimeout/clearTimeout, under the test's control. */
function fakeClock(): {
  schedule: (fn: () => void, ms: number) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
  /** Run everything still scheduled, as if the delay had elapsed. */
  tick: () => void;
  pending: () => number;
} {
  const jobs = new Map<number, () => void>();
  let nextId = 1;
  return {
    schedule: (fn: () => void) => {
      const id = nextId++;
      jobs.set(id, fn);
      return id;
    },
    cancel: (handle: TimerHandle) => {
      jobs.delete(handle as number);
    },
    tick: () => {
      const due = [...jobs.values()];
      jobs.clear();
      for (const fn of due) fn();
    },
    pending: () => jobs.size,
  };
}

function build(): {
  monitor: ConnectivityMonitor;
  source: FakeSource;
  clock: ReturnType<typeof fakeClock>;
} {
  const source = new FakeSource();
  const clock = fakeClock();
  const monitor = new ConnectivityMonitor(source, {
    degradeDelayMs: 2_000,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { monitor, source, clock };
}

describe('ConnectivityMonitor', () => {
  it('knows nothing until it is started', () => {
    const { monitor } = build();
    expect(monitor.status).toBe('unknown');
  });

  it('commits the first reading immediately — a launch with no signal should say so at once', () => {
    const { monitor, source } = build();
    source.reading = OFFLINE;
    monitor.start();
    source.emit(OFFLINE);
    expect(monitor.status).toBe('offline');
  });

  it('holds a drop back, in case it is a handover blip', () => {
    const { monitor, source, clock } = build();
    monitor.start();
    source.emit(ONLINE);

    source.emit(OFFLINE);
    expect(monitor.status).toBe('online');

    clock.tick();
    expect(monitor.status).toBe('offline');
  });

  it('never shows a drop that fixes itself within the delay', () => {
    const { monitor, source, clock } = build();
    monitor.start();
    source.emit(ONLINE);

    source.emit(OFFLINE);
    source.emit(ONLINE);
    clock.tick();

    expect(monitor.status).toBe('online');
  });

  it('recovers immediately — nobody should stare at a stale offline banner', () => {
    const { monitor, source, clock } = build();
    monitor.start();
    source.emit(OFFLINE);
    clock.tick();
    expect(monitor.status).toBe('offline');

    source.emit(ONLINE);
    expect(monitor.status).toBe('online');
  });

  it('holds a move between two failing states too', () => {
    const { monitor, source, clock } = build();
    monitor.start();
    source.emit(OFFLINE);
    clock.tick();

    source.emit(CAPTIVE);
    expect(monitor.status).toBe('offline');
    clock.tick();
    expect(monitor.status).toBe('unreachable');
  });

  it('keeps what it knows when the platform stops being sure', () => {
    const { monitor, source, clock } = build();
    monitor.start();
    source.emit(OFFLINE);
    clock.tick();

    source.emit(UNSURE);
    clock.tick();

    expect(monitor.status).toBe('offline');
  });

  it('notifies subscribers on a change, and only on a change', () => {
    const { monitor, source, clock } = build();
    const listener = jest.fn();
    monitor.subscribe(listener);
    monitor.start();

    source.emit(ONLINE);
    source.emit(ONLINE);
    expect(listener).toHaveBeenCalledTimes(1);

    source.emit(OFFLINE);
    clock.tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying an unsubscribed listener', () => {
    const { monitor, source } = build();
    const listener = jest.fn();
    const unsubscribe = monitor.subscribe(listener);
    monitor.start();
    unsubscribe();

    source.emit(OFFLINE);
    expect(listener).not.toHaveBeenCalled();
  });

  it('drops a pending hold when the state that was pending arrives for real', () => {
    const { monitor, source, clock } = build();
    monitor.start();
    source.emit(ONLINE);
    source.emit(OFFLINE);
    source.emit(ONLINE);

    expect(clock.pending()).toBe(0);
  });

  it('applies a refresh at once — the user asked, so do not make them wait out the delay', async () => {
    const { monitor, source } = build();
    monitor.start();
    source.emit(ONLINE);

    source.reading = OFFLINE;
    await expect(monitor.refresh()).resolves.toBe('offline');
    expect(monitor.status).toBe('offline');
  });

  it('reads the source on start, so a launch does not wait for the first change', () => {
    const { monitor, source } = build();
    monitor.start();
    expect(source.reads).toBe(1);
  });

  it('subscribes once however many times it is started', () => {
    const { monitor, source } = build();
    monitor.start();
    monitor.start();
    expect(source.subscriberCount).toBe(1);
  });

  it('lets go of the source and any pending work when stopped', () => {
    const { monitor, source, clock } = build();
    const stop = monitor.start();
    source.emit(ONLINE);
    source.emit(OFFLINE);

    stop();

    expect(source.subscriberCount).toBe(0);
    expect(clock.pending()).toBe(0);
    clock.tick();
    expect(monitor.status).toBe('online');
  });

  it('survives a source that cannot answer', async () => {
    const source = new FakeSource();
    jest.spyOn(source, 'read').mockRejectedValue(new Error('native module missing'));
    const monitor = new ConnectivityMonitor(source);

    await expect(monitor.refresh()).resolves.toBe('unknown');
    expect(monitor.status).toBe('unknown');
  });
});
