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
  /** App background — warm off-white. */
  background: '#FBFAF8',
  /** Card / elevated surface. */
  surface: '#FFFFFF',
  /** Subtle alternate surface (inputs, pressed states, chips). */
  surfaceAlt: '#F2EFEA',
  /** Hairline borders and dividers. */
  border: '#EBE7E0',

  /** Primary text — charcoal, not pure black. */
  text: '#1C1B19',
  /** Secondary text. */
  textSecondary: '#6E6A63',
  /** Muted captions / hints. */
  textMuted: '#A29D94',

  /** Brand accent — warm coral. */
  accent: '#F1543F',
  /** Accent pressed / darker. */
  accentDark: '#D8412E',
  /** Tint used behind accent icons / soft highlights. */
  accentSoft: '#FDECE8',
  /** Text/icon colour to use on top of the accent. */
  onAccent: '#FFFFFF',

  /** Dark navy/teal ink — used for the floating nav icons & labels (Polarsteps style). */
  ink: '#0E3A53',
  /** Frosted floating-bar surface (slightly translucent off-white). */
  frosted: 'rgba(245,243,239,0.94)',

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
