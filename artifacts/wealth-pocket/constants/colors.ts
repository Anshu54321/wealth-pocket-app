/**
 * Semantic design tokens for the mobile app.
 *
 * Two palettes ship in sync with the same token names so `useColors()` can swap
 * between them. `light` is the default presentation and is intentionally the
 * richer of the two: it carries the glossy surface tokens (`gloss`, `sheen`,
 * `glass`, `accentGradients`) that the light theme relies on for depth. `dark`
 * keeps the same token names with values tuned for low-light contrast, and
 * flattens the gloss so it does not glare.
 *
 * To retarget the brand, change values here only. Screens read tokens through
 * `useColors()` and never hardcode hex, so a palette swap needs no screen edits.
 */

export type Gradient = readonly [string, string];

export interface ColorScheme {
  text: string;
  tint: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  positive: string;
  warning: string;
  gold: string;
  overlay: string;
  subtleGreen: string;
  chartColors: readonly string[];

  /** Page background stops, used for the screen-level gradient wash. */
  backgroundGradient: Gradient;
  /** Glossy card gradient. Should read as a lit surface, not a flat fill. */
  gloss: Gradient;
  /** Stronger, saturated surface for hero panels and totals. */
  glossStrong: Gradient;
  /** Translucent white overlay that fakes a specular highlight. */
  sheen: string;
  /** Translucent surface for inset chips, rails, and pill backgrounds. */
  glass: string;
  /** Border color for glass surfaces. */
  glassBorder: string;
  /** Colored glow used for elevation on cards. */
  shadow: string;
  /** Extra vivid hues so categories and tabs are distinguishable at a glance. */
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  /** Per-accent two-stop gradients, indexed alongside `chartColors`. */
  accentGradients: readonly Gradient[];
}

const dark: ColorScheme = {
  text: '#E8FFF6',
  tint: '#2BE8A0',
  background: '#04140E',
  foreground: '#E8FFF6',
  card: '#08201A',
  cardForeground: '#E8FFF6',
  primary: '#2BE8A0',
  primaryForeground: '#00281A',
  secondary: '#0F3227',
  secondaryForeground: '#DFFFF1',
  muted: '#0B2A21',
  mutedForeground: '#7FB8A4',
  accent: '#C6FF4F',
  accentForeground: '#122800',
  destructive: '#FF6B81',
  destructiveForeground: '#340E16',
  border: '#154A3B',
  input: '#0E3025',
  positive: '#2BE8A0',
  warning: '#FFC857',
  gold: '#FFC857',
  overlay: 'rgba(0, 10, 7, 0.84)',
  subtleGreen: '#0C3D2E',
  chartColors: ['#2BE8A0', '#C6FF4F', '#4DD8FF', '#B98BFF', '#FFD166', '#FF8A6B'],
  backgroundGradient: ['#04140E', '#082A20'],
  gloss: ['#0D2A21', '#071A14'],
  glossStrong: ['#17E6A8', '#0C8F67'],
  sheen: 'rgba(255, 255, 255, 0.07)',
  glass: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(43, 232, 160, 0.22)',
  shadow: '#000000',
  accent2: '#4DD8FF',
  accent3: '#B98BFF',
  accent4: '#FFD166',
  accent5: '#FF8A6B',
  accentGradients: [
    ['#2BE8A0', '#12B981'],
    ['#C6FF4F', '#8FD614'],
    ['#4DD8FF', '#2F9BE8'],
    ['#B98BFF', '#8B5CF6'],
    ['#FFD166', '#F59E0B'],
    ['#FF8A6B', '#F0603C'],
  ],
};

const light: ColorScheme = {
  text: '#0A1F1A',
  tint: '#00B981',
  background: '#F3F7FB',
  foreground: '#0A1F1A',
  card: '#FFFFFF',
  cardForeground: '#0A1F1A',
  primary: '#00C08B',
  primaryForeground: '#FFFFFF',
  secondary: '#E4F6EF',
  secondaryForeground: '#05301F',
  muted: '#EEF3F9',
  mutedForeground: '#5A6E7D',
  accent: '#6D4AFF',
  accentForeground: '#FFFFFF',
  destructive: '#E11D48',
  destructiveForeground: '#FFFFFF',
  border: '#E1EAF3',
  input: '#F1F6FB',
  positive: '#00B981',
  warning: '#F59E0B',
  gold: '#EAB308',
  overlay: 'rgba(9, 26, 40, 0.42)',
  subtleGreen: '#D6F5E9',

  // Light-mode depth. The page wash is a barely-there blue-to-white so screens
  // do not read as flat #FFF, and cards sit on it with a white-to-tinted gloss.
  backgroundGradient: ['#F7FAFD', '#EAF3FB'],
  gloss: ['#FFFFFF', '#F0F6FC'],
  glossStrong: ['#00D39B', '#00A97A'],
  sheen: 'rgba(255, 255, 255, 0.72)',
  glass: 'rgba(255, 255, 255, 0.66)',
  glassBorder: 'rgba(255, 255, 255, 0.85)',
  shadow: '#1B3A57',

  // Saturated accents. Deliberately higher chroma than the dark scheme: on a
  // light background these need more saturation to carry the same visual weight.
  accent2: '#FF4D8D',
  accent3: '#2F7DFF',
  accent4: '#FF8A3D',
  accent5: '#8B5CF6',
  chartColors: ['#00C08B', '#6D4AFF', '#FF4D8D', '#2F7DFF', '#FF8A3D', '#00B8D9'],
  accentGradients: [
    ['#00D39B', '#00A97A'],
    ['#8B7BFF', '#5B31E8'],
    ['#FF6BA3', '#F03D7C'],
    ['#5B9BFF', '#1F63E0'],
    ['#FFA35C', '#F5701A'],
    ['#3ED2F0', '#0891B2'],
  ],
};

const colors = {
  dark,
  light,
  radius: 22,
};

export default colors;
