import type React from 'react';

/**
 * What a production bundle gets instead of the grade inspector.
 *
 * Nothing imports this file by name — `metro.config.js` resolves
 * `./PhotoGradeInspector` here when the bundle is neither a dev build nor
 * staging, so the screen, its hook, and the use case behind it never enter the
 * dependency graph. Keep the props identical to the real component's.
 */
export const PhotoGradeInspector: React.FC<{ publisherId: string; onClose?: () => void }> = () =>
  null;

/** The Settings row that opens it — see the real module for why it lives there. */
export const PhotoGradeInspectorCard: React.FC<{ publisherId: string }> = () => null;
