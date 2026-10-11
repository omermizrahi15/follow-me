import { GradingCoordinator } from './GradingCoordinator';

describe('GradingCoordinator', () => {
  it('lets a background run start when nothing else is grading', () => {
    expect(new GradingCoordinator().tryBeginBackground()).not.toBeNull();
  });

  it('refuses a second background run while one is in progress', () => {
    const c = new GradingCoordinator();
    c.tryBeginBackground();
    expect(c.tryBeginBackground()).toBeNull();
  });

  it('allows another background run once the first has ended', () => {
    const c = new GradingCoordinator();
    c.tryBeginBackground()?.end();
    expect(c.tryBeginBackground()).not.toBeNull();
  });

  it('refuses a background run while a live scan is open', async () => {
    const c = new GradingCoordinator();
    const release = await c.beginInteractive();
    expect(c.tryBeginBackground()).toBeNull();
    release();
    expect(c.tryBeginBackground()).not.toBeNull();
  });

  it('a live scan asks the background run to stop and waits for it to finish', async () => {
    const c = new GradingCoordinator();
    const bg = c.tryBeginBackground();
    expect(bg?.shouldStop()).toBe(false);

    let started = false;
    const interactive = c.beginInteractive().then(release => { started = true; return release; });
    expect(bg?.shouldStop()).toBe(true);
    await Promise.resolve();
    expect(started).toBe(false);

    bg?.end();
    (await interactive)();
    expect(started).toBe(true);
  });

  it('ending twice does not free a slot that now belongs to someone else', () => {
    const c = new GradingCoordinator();
    const first = c.tryBeginBackground();
    first?.end();
    c.tryBeginBackground();
    first?.end();
    expect(c.tryBeginBackground()).toBeNull();
  });
});
