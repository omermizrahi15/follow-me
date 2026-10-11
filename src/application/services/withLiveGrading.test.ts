import { GradingCoordinator } from './GradingCoordinator';
import { withLiveGrading } from './withLiveGrading';

class Fake {
  tag = 'fake';
  calls = 0;
  execute(n: number): Promise<number> { this.calls++; return Promise.resolve(n * 2); }
  classifyMore(n: number): Promise<number> { return Promise.resolve(n + 1); }
  other(): string { return this.tag; }
}

describe('withLiveGrading', () => {
  it('passes results through and releases the lease', async () => {
    const c = new GradingCoordinator();
    const live = withLiveGrading(new Fake(), c);
    expect(await live.execute(2)).toBe(4);
    expect(await live.classifyMore(1)).toBe(2);
    expect(c.tryBeginBackground()).not.toBeNull();
  });

  it('holds the lease while the scan runs, so background grading yields', async () => {
    const c = new GradingCoordinator();
    let during: unknown = 'unset';
    const target = new Fake();
    target.execute = (): Promise<number> => { during = c.tryBeginBackground(); return Promise.resolve(1); };
    await withLiveGrading(target, c).execute(1);
    expect(during).toBeNull();
  });

  it('releases the lease when the scan throws', async () => {
    const c = new GradingCoordinator();
    const target = new Fake();
    target.execute = (): Promise<number> => Promise.reject(new Error('x'));
    await expect(withLiveGrading(target, c).execute(1)).rejects.toThrow('x');
    expect(c.tryBeginBackground()).not.toBeNull();
  });

  it('leaves other methods and state alone', () => {
    const live = withLiveGrading(new Fake(), new GradingCoordinator());
    expect(live.other()).toBe('fake');
  });
});
