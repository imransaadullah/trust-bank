/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Same brass/paper palette used across trust-bank's other
        // public-facing surfaces (Gateway's own /docs, the staff
        // console, the status deck) — visual consistency across the
        // platform, not a new identity.
        paper: '#eef1e6',
        'paper-raised': '#f6f7ef',
        ink: '#1c2420',
        'ink-soft': '#47554a',
        brass: '#93641f',
        'brass-strong': '#7a5119',
        line: '#c9d1bd',
        good: '#3f6b4a',
        blocked: '#a15c3f',
        pending: '#55677a',
      },
    },
  },
  plugins: [],
};
