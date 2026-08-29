// bun:test runs source directly, so tsup's build-time `define` substitution
// (which replaces __PACKAGE_NAME__/__PACKAGE_VERSION__ with literal strings
// in the published bundle - see tsup.config.ts) never happens here. Define
// the same two globals by reading package.json directly, so code that
// references them (src/noise-suppression/noiseSuppression.ts's CDN URL
// resolver) works identically under test as it does once built.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
);

(globalThis as Record<string, unknown>).__PACKAGE_NAME__ = pkg.name;
(globalThis as Record<string, unknown>).__PACKAGE_VERSION__ = pkg.version;
