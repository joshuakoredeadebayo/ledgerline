import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

// Ledgerline design tokens.
// Palette: restrained neutral base + one accent + a fixed semantic status set.
// Numbers must always render with tabular figures — see globals.css.
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral base — a deep navy ink on a cool, very light blue paper.
        // Matches the approved dashboard mockup (navy text, soft blue-grey surfaces).
        ink: {
          50: "#f5f8fd",
          100: "#e8eef6",
          200: "#d9e1ee",
          300: "#b9c4d9",
          400: "#8e9bb8",
          500: "#66759a",
          600: "#4a5a82",
          700: "#323f68",
          800: "#1d2a57",
          900: "#0f1b4c",
          950: "#070f33",
        },
        // Accent — royal blue from the mockup (logo, bars, progress, links, primary buttons).
        accent: {
          50: "#eef2fd",
          100: "#dbe5fd",
          300: "#91b0fb",
          500: "#2f62f2",
          600: "#2551d6",
          700: "#1d41ab",
        },
        // Semantic status — used consistently across the whole product, never repurposed
        status: {
          matched: "#0f8f55",      // green — matched / complete / posted
          matchedBg: "#e6f7ef",
          pending: "#b86e00",      // amber — pending review / in progress
          pendingBg: "#fdf3dc",
          exception: "#d92d3a",    // red — exception / blocked / variance
          exceptionBg: "#ffe9ea",
          info: "#2f62f2",         // blue — informational / in sync
          infoBg: "#e8eefe",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.6rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
      },
      spacing: {
        4.5: "1.125rem",
        13: "3.25rem",
        18: "4.5rem",
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
      },
      boxShadow: {
        subtle: "0 1px 2px 0 rgb(16 18 22 / 0.04)",
        panel: "0 4px 16px -4px rgb(16 18 22 / 0.10)",
      },
    },
  },
  plugins: [forms],
};

export default config;
