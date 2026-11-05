import React from 'react';
import { act, create, type Renderer } from 'react-test-renderer';
import { useSongPreview } from './useSongPreview';

const mockPlayer = { loop: false, volume: 1, currentTime: 0, duration: 30, replace: jest.fn(), play: jest.fn(), pause: jest.fn() };
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ url, active }: { url: string | undefined; active: boolean }): null {
  useSongPreview(url, active);
  return null;
}

function mount(url: string | undefined, active: boolean): Renderer {
  let renderer!: Renderer;
  act(() => {
    renderer = create(React.createElement(Probe, { url, active }));
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockPlayer.volume = 1;
  mockPlayer.currentTime = 0;
});

afterEach(() => jest.useRealTimers());

describe('useSongPreview', () => {
  it('loops the preview while active', () => {
    mount('https://x/a.m4a', true);
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: 'https://x/a.m4a' });
    expect(mockPlayer.loop).toBe(true);
    expect(mockPlayer.play).toHaveBeenCalled();
  });

  it('stays silent without a clip or when inactive', () => {
    mount(undefined, true);
    mount('https://x/a.m4a', false);
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it('pauses when the screen unmounts', () => {
    const renderer = mount('https://x/a.m4a', true);
    act(() => renderer.unmount());
    expect(mockPlayer.pause).toHaveBeenCalled();
  });

  it('fades the volume out near the end of the clip, ready for the loop', () => {
    mount('https://x/a.m4a', true);
    mockPlayer.currentTime = 29.25;
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(mockPlayer.volume).toBeCloseTo(0.5);
  });

  it('stops adjusting the volume once unmounted', () => {
    const renderer = mount('https://x/a.m4a', true);
    act(() => renderer.unmount());
    mockPlayer.currentTime = 29.25;
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(mockPlayer.volume).toBe(1);
  });
});
