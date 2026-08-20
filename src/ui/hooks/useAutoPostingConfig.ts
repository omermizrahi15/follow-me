import { useCallback, useEffect, useRef, useState } from 'react';
import { loadConfig, deviceTimezone } from '../../composition/container';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount, PhotosOfMe } from '../../domain/entities/PublisherConfig';
import { SELECTABLE_CATEGORIES } from '../../domain/entities/PhotoClassification';
import { buildOrderedList, enabledCategoriesOf } from '../../domain/services/categoryOrdering';
import type { OrderedCategory } from '../../domain/services/categoryOrdering';

/**
 * The auto-posting settings the publisher is editing, wherever they are editing
 * them.
 *
 * Onboarding and the settings section used to keep two copies of this — two
 * `useState` blocks, two `buildCurrentConfig`s, two option tables — and they
 * had already drifted: the section learned about categories and lookback-aware
 * photo sync, onboarding did not, so where you configured auto-posting decided
 * what it did. One hook, one `PublisherConfig` shape, both callers.
 *
 * Saving is deliberately not here: onboarding saves once on a button and asks
 * for photo-sync consent, the settings section autosaves and must never raise a
 * dialog. Only the *values* are shared.
 */

export interface AutoPostingValues {
  frequency: Frequency;
  photoCount: PhotoCount;
  askBeforePost: boolean;
  notifyDayOfWeek: number;
  notifyTime: string;
  /** Categories in preference order, enabled first — see categoryOrdering. */
  orderedCats: OrderedCategory[];
  pushToken: string;
  /** How much the publisher's own presence in a photo counts for (issue #137). */
  photosOfMe: PhotosOfMe;
}

export interface AutoPostingConfigState extends AutoPostingValues {
  /** Still reading the stored config; nothing below is meaningful yet. */
  isLoading: boolean;
  setFrequency: (f: Frequency) => void;
  setPhotoCount: (n: PhotoCount) => void;
  setAskBeforePost: (v: boolean) => void;
  setNotifyDayOfWeek: (d: number) => void;
  setNotifyTime: (t: string) => void;
  setOrderedCats: (cats: OrderedCategory[]) => void;
  setPushToken: (t: string) => void;
  setPhotosOfMe: (v: PhotosOfMe) => void;
  /** The settings as they stand, as a validated entity. */
  buildConfig: (token?: string) => PublisherConfig;
  /** The lookback window the loaded config was stored with. */
  loadedLookbackDays: number | null;
}

export function useAutoPostingConfig(publisherId: string): AutoPostingConfigState {
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [notifyDayOfWeek, setNotifyDayOfWeek] = useState(0);
  const [notifyTime, setNotifyTime] = useState('18:00');
  const [orderedCats, setOrderedCats] = useState<OrderedCategory[]>(() =>
    SELECTABLE_CATEGORIES.map(cat => ({ cat, enabled: true })),
  );
  const [pushToken, setPushToken] = useState('');
  const [photosOfMe, setPhotosOfMe] = useState<PhotosOfMe>('off');
  const [isLoading, setIsLoading] = useState(true);
  const loadedLookbackRef = useRef<number | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const config = await loadConfig.execute(publisherId);
      setFrequency(config.frequency);
      setPhotoCount(config.photosPerPost);
      setAskBeforePost(config.requireApproval);
      setNotifyDayOfWeek(config.notifyDayOfWeek);
      setNotifyTime(config.notifyTime);
      setOrderedCats(buildOrderedList(config.enabledCategories));
      setPushToken(config.expoPushToken);
      setPhotosOfMe(config.photosOfMe);
      loadedLookbackRef.current = config.lookbackDays;
      setIsLoading(false);
    })();
  }, [publisherId]);

  const buildConfig = useCallback(
    (token?: string): PublisherConfig => {
      const enabledCategories = enabledCategoriesOf(orderedCats);
      return PublisherConfig.create({
        publisherId,
        frequency,
        photosPerPost: photoCount,
        requireApproval: askBeforePost,
        notifyDayOfWeek,
        notifyTime,
        // An empty selection would suggest nothing at all, which is never what
        // switching every category off is asking for.
        enabledCategories:
          enabledCategories.length > 0 ? enabledCategories : [...SELECTABLE_CATEGORIES],
        timezone: deviceTimezone(),
        expoPushToken: token ?? pushToken,
        photosOfMe,
      });
    },
    [publisherId, frequency, photoCount, askBeforePost, notifyDayOfWeek, notifyTime, orderedCats, pushToken, photosOfMe],
  );

  return {
    frequency, photoCount, askBeforePost, notifyDayOfWeek, notifyTime, orderedCats, pushToken,
    photosOfMe,
    isLoading,
    setFrequency, setPhotoCount, setAskBeforePost, setNotifyDayOfWeek, setNotifyTime,
    setOrderedCats, setPushToken, setPhotosOfMe,
    buildConfig,
    loadedLookbackDays: loadedLookbackRef.current,
  };
}

/**
 * Everything a save writes, flattened. Autosave compares this against the last
 * value the server acknowledged, so a re-render (or a section switch) can't
 * trigger a write that changes nothing.
 */
export function snapshotOf(config: PublisherConfig): string {
  return JSON.stringify([
    config.frequency,
    config.photosPerPost,
    config.requireApproval,
    config.notifyDayOfWeek,
    config.notifyTime,
    config.enabledCategories,
    config.timezone,
    config.expoPushToken,
    config.photosOfMe,
  ]);
}
