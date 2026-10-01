import { useColorScheme } from 'react-native';
import colors, { type ColorScheme, type Gradient } from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette plus
 * scheme-independent values like `radius`. Screens must read colors through
 * this hook rather than importing constants/colors.ts directly, so a theme
 * change stays a single-file edit.
 *
 * `preferred` exists because the app pins `userInterfaceStyle: light` in
 * app.json but a device can still be in dark mode. Callers that want the
 * designed presentation (and all its gloss tokens) pass `'light'`.
 */
export function useColors(preferred?: 'light' | 'dark'): ColorScheme & { radius: number } {
  const scheme = useColorScheme();
  const resolved = preferred ?? (scheme === 'dark' ? 'dark' : 'light');
  return { ...colors[resolved], radius: colors.radius };
}

export type { Gradient };
