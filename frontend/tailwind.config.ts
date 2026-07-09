import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Playfair Display', 'serif'],
        body: ['var(--font-body)', 'Space Grotesk', 'sans-serif'],
      },
      colors: {
        sage: {
          50:  '#F4F7F5',
          100: '#E2ECE9',
          200: '#C8D9D2',
          300: '#AFc7BC',
          400: '#8FA89B',
          500: '#738D80',
          600: '#5D7568',
        },
        cream: {
          50: '#FBFBF9',
          100: '#F4F4F0',
        },
        editorial: {
          jet:    '#000000',
          slate:  '#0D0D0D',
          border: '#1A1A1A',
          text:   '#1C1A17',
          muted:  '#5C5852',
        },
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.45', transform: 'scale(1.35)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
      },
      animation: {
        'pulse-dot':      'pulse-dot 1.8s ease-in-out infinite',
        'fade-in-up':     'fade-in-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in':        'fade-in 0.3s ease both',
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer:          'shimmer 2s linear infinite',
      },
      boxShadow: {
        editorial:         '0 8px 28px rgba(28, 26, 23, 0.06), 0 2px 8px rgba(28, 26, 23, 0.04)',
        'editorial-lg':    '0 16px 48px rgba(28, 26, 23, 0.10), 0 4px 16px rgba(28, 26, 23, 0.06)',
        'editorial-dark':  '0 8px 28px rgba(0, 0, 0, 0.50), 0 2px 8px rgba(0, 0, 0, 0.30)',
        'editorial-dark-lg': '0 16px 48px rgba(0, 0, 0, 0.70), 0 4px 16px rgba(0, 0, 0, 0.40)',
      },
    },
  },
  plugins: [],
};

export default config;
