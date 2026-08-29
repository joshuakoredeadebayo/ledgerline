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
        // Neutral base — ink/paper, not pure black/white (softer, more "professional paper" feel)
        ink: {
          50: "#f7f8f9",
          100: "#eceef0",
          200: "#d7dbe0",
          300: "#b7bec7",
          400: "#8f99a6",
          500: "#6b7684",
          600: "#525b68",
          700: "#3f4551",
          800: "#2b2f38",
          900: "#1b1e24",
          950: "#101216",
        },
        // Accent — deep, confident indigo-blue. Used sparingly for primary actions & links.
        accent: {
          50: "#eef1fd",
          100: "#dbe1fb",
          300: "#98a7f0",
          500: "#4655d6",
          600: "#3742b8",
          700: "#2c3695",
        },
        // Semantic status — used consistently across the whole product, never repurposed
        status: {
          matched: "#16794f",      // green — matched / complete / posted
          matchedBg: "#e7f5ee",
          pending: "#a15c00",      // amber — pending review / in progress
          pendingBg: "#fbf0dc",
          exception: "#b3261e",    // red — exception / blocked / variance
          exceptionBg: "#fbe9e8",
          info: "#1a5fb4",         // blue — informational / in sync
          infoBg: "#e7f0fb",
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
