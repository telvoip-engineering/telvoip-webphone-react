export default {
  plugins: {
    // Must run before tailwindcss so @import "../theme/tokens.css" is
    // actually inlined into the output, not passed through as literal
    // (unresolvable, relative-to-a-path-that-no-longer-exists-in-dist) text.
    "postcss-import": {},
    tailwindcss: {},
    autoprefixer: {},
    cssnano: { preset: "default" },
  },
};
