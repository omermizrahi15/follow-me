// Composes a whole photo batch into ONE image via Cloudinary's on-the-fly URL
// transformations, so subscribers get a single WhatsApp message (with caption)
// instead of one message per photo. No server-side image processing — the URL
// itself instructs Cloudinary to build the grid.

interface ParsedCloudinaryUrl {
  /** e.g. https://res.cloudinary.com/<cloud>/image/upload */
  prefix: string;
  /** e.g. v1783327761 */
  version: string;
  /** public id without extension */
  publicId: string;
}

function parseCloudinaryUrl(url: string): ParsedCloudinaryUrl | null {
  const m = url.match(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload)\/(v\d+)\/(.+?)(\.[A-Za-z0-9]+)?$/,
  );
  if (m == null) return null;
  return { prefix: m[1], version: m[2], publicId: m[3] };
}

/**
 * Builds a square-cell grid collage URL from Cloudinary photo URLs.
 * Returns null when a collage isn't possible (fewer than 2 photos, a
 * non-Cloudinary URL, or mixed Cloudinary accounts) — callers should fall
 * back to individual sends. Cells left over on the last row show the dark
 * background. Output is JPEG (WhatsApp-safe) with bounded canvas size.
 */
export function collageUrl(urls: string[], cellPxMax = 500, maxCanvasPx = 2000): string | null {
  if (urls.length < 2) return null;
  const parsed: ParsedCloudinaryUrl[] = [];
  for (const url of urls) {
    const p = parseCloudinaryUrl(url);
    if (p == null) return null;
    parsed.push(p);
  }
  const first = parsed[0];
  if (!parsed.every(p => p.prefix === first.prefix)) return null;

  const cols = Math.ceil(Math.sqrt(urls.length));
  const rows = Math.ceil(urls.length / cols);
  const cell = Math.min(cellPxMax, Math.floor(maxCanvasPx / cols));
  const width = cols * cell;
  const height = rows * cell;

  const steps: string[] = [
    // First photo fills cell (0,0)…
    `c_fill,w_${cell},h_${cell}`,
    // …then the canvas is extended to the full grid, photo pinned top-left.
    `b_rgb:1a1a1a,c_pad,g_north_west,w_${width},h_${height}`,
  ];
  parsed.slice(1).forEach((p, idx) => {
    const i = idx + 1;
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    // Layer public ids use ':' as the folder separator.
    steps.push(`l_${p.publicId.replace(/\//g, ':')},c_fill,w_${cell},h_${cell}`);
    steps.push(`fl_layer_apply,g_north_west,x_${x},y_${y}`);
  });
  steps.push('f_jpg,q_auto:good');

  return `${first.prefix}/${steps.join('/')}/${first.version}/${first.publicId}.jpg`;
}
