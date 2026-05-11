/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Yacht navy is now the page background. The bg.* tokens below paint
        // raised surfaces — cards, inputs, pills — and are pure white with
        // no visible outline. The legacy `line` token is kept transparent
        // so existing `border-line` references render but are invisible.
        bg: {
          DEFAULT: '#ffffff',
          soft:    '#ffffff',
          card:    '#ffffff',
        },
        line: 'transparent',
        ink: {
          DEFAULT: '#0a0e14',  // near-black body text on white surfaces
          dim:     '#3a4250',
          faint:   '#6b7280',
        },
        brand: {
          // Brand accent is now water blue. Used for primary buttons / links
          // / focus rings on light surfaces.
          DEFAULT: '#5eccfa',
          dark:    '#3eb8e8',
          soft:    '#cfeefd',
        },
        // Success stays green so "+5%" change indicators read intuitively.
        // The TxStatus screen overrides its bg inline to water-blue.
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
