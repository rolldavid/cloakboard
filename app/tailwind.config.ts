import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'hsl(var(--background))',
          secondary: 'hsl(var(--background-secondary))',
          tertiary: 'hsl(var(--background-tertiary))',
        },
        foreground: {
          DEFAULT: 'hsl(var(--foreground))',
          secondary: 'hsl(var(--foreground-secondary))',
          muted: 'hsl(var(--foreground-muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          hover: 'hsl(var(--accent-hover))',
          muted: 'hsl(var(--accent-muted))',
        },
        border: {
          DEFAULT: 'hsl(var(--border))',
          hover: 'hsl(var(--border-hover))',
        },
        ring: 'hsl(var(--ring))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          hover: 'hsl(var(--card-hover))',
        },
        status: {
          success: 'hsl(var(--status-success))',
          error: 'hsl(var(--status-error))',
          warning: 'hsl(var(--status-warning))',
          info: 'hsl(var(--status-info))',
        },
        privacy: {
          maximum: 'hsl(var(--privacy-maximum))',
          balanced: 'hsl(var(--privacy-balanced))',
          transparent: 'hsl(var(--privacy-transparent))',
        },
      },
      borderRadius: {
        lg: 'calc(var(--radius) * 2)',
        md: 'var(--radius)',
        sm: 'calc(var(--radius) * 0.5)',
      },
    },
  },
  plugins: [],
};

export default config;
