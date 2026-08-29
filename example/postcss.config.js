// Empty on purpose: stops Vite's upward directory search from picking up
// the parent package's postcss.config.js (which expects Tailwind content
// globs relative to *that* package, not this app). This example app has no
// Tailwind/PostCSS pipeline of its own - it only imports the package's
// already-compiled dist/style.css.
export default { plugins: {} };
