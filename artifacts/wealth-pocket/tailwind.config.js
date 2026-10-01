/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        midnight: '#07131E',
        teal: '#3AD5C6',
        coral: '#F3A97A',
      },
    },
  },
  plugins: [],
};