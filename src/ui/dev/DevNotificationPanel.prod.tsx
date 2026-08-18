import type React from 'react';
import type { PublisherConfig } from '../../domain/entities/PublisherConfig';

/**
 * What a production bundle gets instead of the real dev panel.
 *
 * Nothing imports this file by name — `metro.config.js` resolves
 * `./DevNotificationPanel` here when the bundle is neither a dev build nor
 * staging, so the test-notification code and its sample image URLs never enter
 * the dependency graph. Keep the props identical to the real panel's.
 */
export interface DevNotificationPanelProps {
  publisherId: string;
  config: PublisherConfig;
}

export const DevNotificationPanel: React.FC<DevNotificationPanelProps> = () => null;
