/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Light cream palette — non-Dashboard screens use this.
        // The Dashboard paints its own water+deck background on top.
        bg: {
          DEFAULT: '#fbf3df',  // base — light warm cream
          soft:    '#f4ead0',  // input / sub-bar background (slightly darker)
          card:    '#ffffff',  // raised cards & sheets
        },
        line: '#e6d8b3',
        ink: {
          DEFAULT: '#2e2114',  // deep brown text
          dim:     '#6b4423',
          faint:   '#9b7e58',
        },
        brand: {
          DEFAULT: '#cc7a18',
          dark:    '#a35d10',
          soft:    '#fce4c0',
        },
        success: { DEFAULT: '#16a34a', soft: '#dcfce7' },
        warn: '#d97706',
        danger: '#dc2626',
      },
      fontFamily: {
        // Single Roboto stack for everything — text and numerics alike.
        sans: ['Roboto', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Roboto', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(245,165,36,0.25), 0 8px 30px -8px rgba(245,165,36,0.45)',
      },
    },
  },
  plugins: [],
};
