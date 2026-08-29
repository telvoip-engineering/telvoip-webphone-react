import type { Config } from "tailwindcss";

// Dev-time authoring tool only - compiled to a single dist/style.css by
// `bun run build:css`, never a runtime dependency for consumers. Every rule
// is scoped under `.twp-root` AND marked !important (Tailwind's `important`
// option applied to a selector does both), so our declarations always win
// within our own root regardless of what a consuming app's own Tailwind
// setup (if it has one) generates for a same-named utility class elsewhere
// on the page - without needing a `prefix` on every class name, which would
// require hand-rewriting every className string in every ported component.
export default {
  important: ".twp-root",
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        primary: "var(--twp-color-primary)",
        "primary-contrast": "var(--twp-color-primary-contrast)",
        secondary: "var(--twp-color-secondary)",
        danger: "var(--twp-color-danger)",
        surface: "var(--twp-color-surface)",
        "surface-muted": "var(--twp-color-surface-muted)",
        border: "var(--twp-color-border)",
        "text-primary": "var(--twp-color-text-primary)",
        "text-secondary": "var(--twp-color-text-secondary)",
      },
      borderRadius: {
        twp: "var(--twp-radius)",
      },
    },
  },
  plugins: [],
} satisfies Config;
