import { statusFromReading } from '../../domain/services/connectivityCopy';
import type { ConnectionStatus } from '../../domain/entities/Connectivity';
import type { ConnectionReading, IConnectivitySource } from '../../domain/interfaces';

/**
 * How long a connection has to stay bad before the app admits it (issue #145).
 *
 * Every wifi-to-cellular handover, lift, and tunnel produces a sub-second drop.
 * Reporting those honestly means a banner that blinks at a user who never lost
 * anything, and the app that cries wolf gets ignored when the connection really
 * does go. Recovery is not delayed — see `commit`.
 */
const DEGRADE_DELAY_MS = 2_500;

/** Opaque timer id: a `number` on React Native, a `Timeout` under Node. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

interface Options {
  degradeDelayMs?: number;
  /** Injectable timers — production uses the globals; tests drive them by hand. */
  schedule?: (fn: () => void, ms: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

/**
 * The app's single answer to "are we online?".
 *
 * Sits between the platform's raw stream of readings and everything that wants
 * to know, for three reasons the callers should not each solve again:
 *
 * - it settles the flapping (above), so consumers see states that lasted;
 * - it keeps the last known answer when the platform stops being sure, rather
 *   than falling back to a scary default;
 * - it is a `useSyncExternalStore` source, so a React tree can read it without
 *   the state being duplicated per screen.
 *
 * The platform half is behind `IConnectivitySource`, which is what makes all of
 * the above testable without a device.
 */
export class ConnectivityMonitor {
  private status_: ConnectionStatus = 'unknown';
  private pending: { status: ConnectionStatus; handle: TimerHandle } | null = null;
  private unsubscribeSource: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly degradeDelayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => TimerHandle;
  private readonly cancel: (handle: TimerHandle) => void;

  constructor(
    private readonly source: IConnectivitySource,
    options: Options = {},
  ) {
    this.degradeDelayMs = options.degradeDelayMs ?? DEGRADE_DELAY_MS;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel ?? (handle => clearTimeout(handle));
  }

  /** The settled status. Stable between changes, as `useSyncExternalStore` requires. */
  get status(): ConnectionStatus {
    return this.status_;
  }

  /**
   * Begin watching. Idempotent — the app root calls it, and anything that wants
   * connectivity before the root has mounted can call it too. Returns a stop
   * function, so it drops straight into a React effect.
   */
  start(): () => void {
    if (this.unsubscribeSource != null) return () => this.stop();
    this.unsubscribeSource = this.source.subscribe(reading => this.observe(reading));
    // The subscription reports changes; this asks what is true right now, so a
    // launch on a dead network says so without waiting for something to change.
    void this.refresh();
    return () => this.stop();
  }

  stop(): void {
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
    this.clearPending();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Take a fresh reading and apply it immediately, skipping the settle delay.
   *
   * This is the "try again" button. Somebody who has just asked should see the
   * answer, not wait out a delay that exists to absorb changes they never made.
   * A source that throws leaves the status alone: an unanswerable probe is not
   * evidence of anything.
   */
  async refresh(): Promise<ConnectionStatus> {
    try {
      const reading = await this.source.read();
      const next = statusFromReading(reading);
      if (next !== 'unknown') this.commit(next);
    } catch {
      // Nothing measured, nothing to say.
    }
    return this.status_;
  }

  private observe(reading: ConnectionReading): void {
    const next = statusFromReading(reading);
    // The platform lost track of the connection; it didn't tell us the
    // connection is bad. Keep the last thing we actually knew.
    if (next === 'unknown') return;

    if (next === this.status_) {
      // Whatever we were waiting to report is moot — we're already there.
      this.clearPending();
      return;
    }

    // Recovery is never delayed, and the first real reading is the truth rather
    // than a change worth doubting.
    if (next === 'online' || this.status_ === 'unknown') {
      this.commit(next);
      return;
    }

    if (this.pending?.status === next) return;
    this.clearPending();
    this.pending = {
      status: next,
      handle: this.schedule(() => {
        this.pending = null;
        this.commit(next);
      }, this.degradeDelayMs),
    };
  }

  private commit(next: ConnectionStatus): void {
    this.clearPending();
    if (next === this.status_) return;
    this.status_ = next;
    for (const listener of this.listeners) listener();
  }

  private clearPending(): void {
    if (this.pending == null) return;
    this.cancel(this.pending.handle);
    this.pending = null;
  }
}
