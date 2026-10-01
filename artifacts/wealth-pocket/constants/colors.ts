/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#F1F4EE',
    tint: '#B5D58B',
    background: '#07110D',
    foreground: '#F1F4EE',
    card: '#101D16',
    cardForeground: '#F1F4EE',
    primary: '#B5D58B',
    primaryForeground: '#152215',
    secondary: '#19291F',
    secondaryForeground: '#E7ECE4',
    muted: '#17251D',
    mutedForeground: '#95A397',
    accent: '#D9BE82',
    accentForeground: '#201D14',
    destructive: '#EA7779',
    destructiveForeground: '#220F10',
    border: '#26372D',
    input: '#203128',
    positive: '#9FD18C',
    warning: '#D9BE82',
    gold: '#D9BE82',
    overlay: 'rgba(1, 8, 5, 0.76)',
    subtleGreen: '#173426',
  },

  dark: {
    text: '#F1F4EE',
    tint: '#B5D58B',
    background: '#07110D',
    foreground: '#F1F4EE',
    card: '#101D16',
    cardForeground: '#F1F4EE',
    primary: '#B5D58B',
    primaryForeground: '#152215',
    secondary: '#19291F',
    secondaryForeground: '#E7ECE4',
    muted: '#17251D',
    mutedForeground: '#95A397',
    accent: '#D9BE82',
    accentForeground: '#201D14',
    destructive: '#EA7779',
    destructiveForeground: '#220F10',
    border: '#26372D',
    input: '#203128',
    positive: '#9FD18C',
    warning: '#D9BE82',
    gold: '#D9BE82',
    overlay: 'rgba(1, 8, 5, 0.76)',
    subtleGreen: '#173426',
  },

  radius: 22,
};

export default colors;
