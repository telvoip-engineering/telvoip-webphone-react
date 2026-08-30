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
    // doesn't notice dist/ changed underneath it - excluding it here means
    // Vite always reads the current dist/ files directly instead of a
    // stale pre-bundled copy. If you still see old behavior after a fresh
    // `bun run build` in the repo root, stop the dev server, delete
    // example/node_modules/.vite, and restart - that clears any cache
    // written before this config existed.
    exclude: ["@telvoip/webphone-react"],
  },
});
