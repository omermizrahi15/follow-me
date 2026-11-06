// react-test-renderer ships no types and the repo has no @types for it; this is
// just the slice the hook tests use.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';
  export interface Renderer {
    unmount: () => void;
  }
  export function create(element: ReactElement): Renderer;
  export function act(callback: () => void): void;
}
