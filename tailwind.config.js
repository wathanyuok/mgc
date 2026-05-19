/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Match HTML prototype palette
        brand: {
          DEFAULT: '#0a5dc2',
          dark: '#084e9e',
          light: '#e9f2fb',
        },
        ink: '#1c1c1c',
        muted: '#6b7280',
        line: '#d1d5db',
        soft: '#f7f8fa',
        success: '#10b981',
        warn: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
