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
});
