import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
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
        template: {
          indigo: 'hsl(var(--template-indigo))',
          emerald: 'hsl(var(--template-emerald))',
          rose: 'hsl(var(--template-rose))',
          blue: 'hsl(var(--template-blue))',
          purple: 'hsl(var(--template-purple))',
          slate: 'hsl(var(--template-slate))',
          pink: 'hsl(var(--template-pink))',
          amber: 'hsl(var(--template-amber))',
          violet: 'hsl(var(--template-violet))',
          cyan: 'hsl(var(--template-cyan))',
        },
      },
      borderRadius: {
        lg: 'calc(var(--radius) * 2)',
        md: 'var(--radius)',
        sm: 'calc(var(--radius) * 0.5)',
      },
      borderColor: {
        DEFAULT: 'hsl(var(--border))',
      },
    },
  },
  plugins: [],
};

export default config;
