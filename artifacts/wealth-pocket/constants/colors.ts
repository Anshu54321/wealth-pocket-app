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
    text: '#F0F7FA',
    tint: '#3AD5C6',
    background: '#07131E',
    foreground: '#F0F7FA',
    card: '#0F202C',
    cardForeground: '#F0F7FA',
    primary: '#3AD5C6',
    primaryForeground: '#052B2B',
    secondary: '#152B38',
    secondaryForeground: '#E8F2F5',
    muted: '#112531',
    mutedForeground: '#94AAB6',
    accent: '#F3A97A',
    accentForeground: '#2C180F',
    destructive: '#FF7085',
    destructiveForeground: '#300E17',
    border: '#263E4A',
    input: '#18313E',
    positive: '#3AD5C6',
    warning: '#F7C66A',
    gold: '#F7C66A',
    overlay: 'rgba(1, 8, 14, 0.82)',
    subtleGreen: '#103839',
    chartColors: ['#3AD5C6', '#9189F2', '#F28C82', '#7DBDFF', '#F5C36B'],
  },

  dark: {
    text: '#F0F7FA',
    tint: '#3AD5C6',
    background: '#07131E',
    foreground: '#F0F7FA',
    card: '#0F202C',
    cardForeground: '#F0F7FA',
    primary: '#3AD5C6',
    primaryForeground: '#052B2B',
    secondary: '#152B38',
    secondaryForeground: '#E8F2F5',
    muted: '#112531',
    mutedForeground: '#94AAB6',
    accent: '#F3A97A',
    accentForeground: '#2C180F',
    destructive: '#FF7085',
    destructiveForeground: '#300E17',
    border: '#263E4A',
    input: '#18313E',
    positive: '#3AD5C6',
    warning: '#F7C66A',
    gold: '#F7C66A',
    overlay: 'rgba(1, 8, 14, 0.82)',
    subtleGreen: '#103839',
    chartColors: ['#3AD5C6', '#9189F2', '#F28C82', '#7DBDFF', '#F5C36B'],
  },

  radius: 22,
};

export default colors;
