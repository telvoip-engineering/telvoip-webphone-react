import type { Config } from "tailwindcss";

// Dev-time authoring tool only - compiled to a single dist/style.css by
// `bun run build:css`, never a runtime dependency for consumers. Every
// utility class is prefixed `twp-` and scoped under `.twp-root` so nothing
// here can collide with (or be overridden by) a consuming app's own
// Tailwind setup, if it has one.
export default {
  prefix: "twp-",
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
