/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Mirrors the dark palette in constants/colors.ts. Runtime components
        // read tokens via useColors() so they follow the active scheme; these
        // names exist for the few static className usages.
        midnight: '#04140E',
        emerald: '#2BE8A0',
        lime: '#C6FF4F',
        coral: '#FF6B81',
      },
    },
  },
  plugins: [],
};