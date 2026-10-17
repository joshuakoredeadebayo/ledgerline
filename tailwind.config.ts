import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

// Ledgerline design tokens.
// Palette: the four brand colors (see below) + a fixed semantic status set (green, amber, red keep their meaning).
// Numbers must always render with tabular figures — see globals.css.
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette — four colors:
        //   Electric Blue #100DED  (primary: buttons, links, charts, focus)
        //   Deep Blue     #02007C  (pressed states, active navigation, strong emphasis)
        //   Black         #000000  (text and figures)
        //   White         #FFFFFF  (surfaces)
        // Everything else below is a tint or shade of those four, so greys carry a faint blue cast.
        ink: {
          50: "#f7f7fd",
          100: "#ececf6",
          200: "#dcdcec",
          300: "#b9b9d3",
          400: "#8b8bad",
          500: "#62627f",
          600: "#46465f",
          700: "#2f2f45",
          800: "#17172a",
          900: "#000000",
          950: "#000000",
        },
        accent: {
          50: "#f0f0fe",
          100: "#dbdbfc",
          300: "#9392f7",
          500: "#100ded",
          600: "#0d0abe",
          700: "#02007c",
        },
        // Semantic status — used consistently across the whole product, never repurposed
        status: {
          matched: "#0f8f55",      // green — matched / complete / posted
          matchedBg: "#e6f7ef",
          pending: "#b86e00",      // amber — pending review / in progress
          pendingBg: "#fdf3dc",
          exception: "#d92d3a",    // red — exception / blocked / variance
          exceptionBg: "#ffe9ea",
          info: "#100ded",         // brand blue — informational / in sync
          infoBg: "#ececfd",
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
