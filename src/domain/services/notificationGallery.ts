/**
 * Resolves the photos a cached batch actually chose into URLs a notification can
 * render (issue #85).
 *
 * A batch that came from an on-device scan stores iOS `ph://` asset uris, which
 * neither `FileSystem.downloadAsync` nor the notification extensions can read. The
 * uploaded Cloudinary copy of the same photo lives in `candidate_photos` keyed by
 * the asset id — which is exactly the cached photo's `id` — so a scanned batch is
 * recoverable rather than unusable. The previous code filtered `ph://` entries out
 * and quietly backfilled with unrelated recent candidates, so the test push showed
 * photos the review screen never picked.
 */

/** The minimum a caller must supply per photo: the asset id and whatever url it holds. */
export interface ResolvablePhoto {
  id: string;
  url: string;
}

export interface ResolvedGallery {
  /** Remote urls for the chosen photos, in batch order, deduped. */
  urls: string[];
  /** Ids of chosen photos with no remote copy — reportable, never silently replaced. */
  missing: string[];
}

/** Ids in `batch` whose url isn't already remote, i.e. the ones needing a lookup. */
export function assetIdsNeedingLookup(batch: ResolvablePhoto[]): string[] {
  return batch.filter(p => !isRemote(p.url)).map(p => p.id);
}

function isRemote(url: string): boolean {
  return url.startsWith('http');
}

/**
 * Maps the first `want` chosen photos to remote urls, preferring a url that is
 * already remote and otherwise falling back to `cloudUrlByAssetId`.
 */
export function resolveChosenGalleryUrls(
  batch: ResolvablePhoto[],
  cloudUrlByAssetId: Map<string, string>,
  want: number,
): ResolvedGallery {
  const urls: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const photo of batch.slice(0, want)) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);

    const url = isRemote(photo.url) ? photo.url : cloudUrlByAssetId.get(photo.id);
    if (url == null) missing.push(photo.id);
    else urls.push(url);
  }

  return { urls, missing };
}
