import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deliberately a Vite app, not Next.js - proves the package has no hidden
// framework coupling (a Next-only bug would be invisible if the only
// consumer we ever tested was also Next).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // The package is linked locally (file:.. in package.json), and its
    // dist/ output changes on every `bun run build` in the parent repo.
    // Vite's dependency pre-bundler caches node_modules packages in
    // node_modules/.vite/deps and, for a locally-linked package, often
    // doesn't notice dist/ changed underneath it.
    //
    // NOTE: `exclude: ["@telvoip/webphone-react"]` was tried here first and
    // reverted - excluding the package also stops Vite's crawler from
    // pre-bundling *its* transitive dependencies (jssip is CommonJS), which
    // broke module resolution entirely (blank page). `force: true` instead:
    // always re-optimize (including transitive deps) on every dev server
    // start, which is enough for the actual workflow here (rebuild dist/,
    // then restart the dev server - not hot-reloading a running server
    // mid-rebuild) without touching what gets pre-bundled.
    force: true,
  },
});
