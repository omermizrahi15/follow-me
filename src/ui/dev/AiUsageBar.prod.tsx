import type React from 'react';

/**
 * What a production bundle gets instead of the AI budget bar.
 *
 * Nothing imports this file by name — `metro.config.js` resolves
 * `./AiUsageBar` here when the bundle is neither a dev build nor staging, so
 * the bar, its hook and the quota read behind it never enter the dependency
 * graph. Keep the props identical to the real component's.
 */
export const AiUsageBar: React.FC<{ publisherId: string }> = () => null;
