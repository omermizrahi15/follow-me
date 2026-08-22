/**
 * Central design tokens for the app.
 *
 * Light, warm, photo-forward look inspired by Polarsteps: off-white
 * backgrounds, charcoal text, a single coral accent, soft rounded cards.
 *
 * Screens and components should pull every colour, spacing and radius value
 * from here rather than hardcoding hex strings, so the look stays consistent
 * and is easy to retheme in one place.
 */

export const colors = {
  /** App background — soft slate-tinted off-white, so white surfaces (cards,
   *  the Home sheet) read as raised layers instead of blending in. */
  background: '#F2F5F8',
  /** Card / elevated surface. */
  surface: '#FFFFFF',
  /** Subtle alternate surface (inputs, pressed states, chips). */
  surfaceAlt: '#EEF2F6',
  /** Hairline borders and dividers. */
  border: '#E2E8F0',

  /** Primary text — near-black slate. */
  text: '#13212B',
  /** Secondary text. */
  textSecondary: '#5A6672',
  /** Muted captions / hints. */
  textMuted: '#9AA5AE',

  /** Brand accent — strong deep blue (the "Add post" colour). */
  accent: '#0E3A53',
  /** Accent pressed / darker. */
  accentDark: '#0A2B40',
  /** Tint used behind accent icons / soft highlights. */
  accentSoft: '#E6EEF3',
  /** Text/icon colour to use on top of the accent. */
  onAccent: '#FFFFFF',

  /** Same deep blue, used for the floating nav icons & labels — every tab,
   *  selected or not. Only the halo below marks the selection. */
  ink: '#0E3A53',
  /** Halo behind the selected nav tab (its icon and caption together). A wash
   *  rather than a solid chip: the bar it sits in is frosted glass, and an
   *  opaque grey lozenge on top of that read as a sticker laid over the glass
   *  instead of part of it. Kept faint so it never competes with the navy icon
   *  standing on it. */
  navPill: 'rgba(14,58,83,0.13)',
  /** Wash laid over the nav bar's blur — a tint, not a fill. Light enough that
   *  whatever passes beneath the bar still shows through as blurred colour;
   *  above roughly 0.7 the glass reads as plain white. Distinct from `frosted`
   *  because that one has no blur under it and has to carry legibility alone. */
  navGlass: 'rgba(248,250,252,0.55)',
  /** Translucent chip surface for labels sitting straight on a photo. No blur
   *  behind it, so it stays nearly opaque — this is what keeps the text on it
   *  readable over a bright sky or a dark shoreline alike. */
  frosted: 'rgba(244,247,250,0.92)',

  /** WhatsApp brand green (share action). */
  whatsapp: '#25D366',

  /** Success / positive. */
  success: '#2BA84A',
  /** Error / destructive. */
  danger: '#E5484D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  /** Sheet corners — deep enough that the map reads as continuing behind it. */
  sheet: 32,
  pill: 999,
} as const;

export const typography = {
  /** Large screen title. */
  largeTitle: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  /** Standard screen title. */
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  /** Card / section heading. */
  heading: { fontSize: 17, fontWeight: '600' as const },
  /** Body copy. */
  body: { fontSize: 15, fontWeight: '400' as const },
  /** Secondary / caption. */
  caption: { fontSize: 13, fontWeight: '400' as const },
  /** Button label. */
  button: { fontSize: 15, fontWeight: '600' as const },
} as const;

/**
 * Soft elevation presets. Spread onto a style: `...shadow.card`.
 * iOS reads shadow*, Android reads elevation.
 */
export const shadow = {
  card: {
    shadowColor: '#1C1B19',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#1C1B19',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const theme = { colors, spacing, radius, typography, shadow } as const;

export type Theme = typeof theme;
