// Injected at build time by tsup.config.ts's `define`, read from package.json.
// Used to build a version-pinned jsdelivr URL for the noise-suppression
// assets, so it always matches the exact version a consumer has installed.
declare const __PACKAGE_NAME__: string;
declare const __PACKAGE_VERSION__: string;
