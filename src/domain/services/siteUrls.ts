// Single source of truth for where the public website lives. Moving off the
// GitHub Pages user path to a custom domain is then one value (the
// EXPO_PUBLIC_SITE_URL build var in the app, SITE_BASE_URL in Edge Functions),
// not a hunt through the code. Pure, import-free so both runtimes can use it.

/** Where the site is served today; replace with the custom domain at launch. */
export const DEFAULT_SITE_URL = 'https://omermizrahi15.github.io/follow-me';

export interface SiteUrls {
  privacy: string;
  terms: string;
  join: string;
  gallery: string;
}

export function siteUrls(base: string | undefined): SiteUrls {
  const trimmed = (base ?? '').trim().replace(/\/+$/, '');
  const root = trimmed.startsWith('https://') ? trimmed : DEFAULT_SITE_URL;
  return {
    privacy: `${root}/privacy/`,
    terms: `${root}/terms/`,
    join: `${root}/join/`,
    gallery: `${root}/gallery.html`,
  };
}
