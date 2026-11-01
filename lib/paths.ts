/**
 * URL prefix when the app is served from a sub-path, e.g. "/pose-studio" on GitHub Pages
 * (set NEXT_PUBLIC_BASE_PATH at build time). Next.js prefixes its own routes and assets;
 * hand-written URLs to files in public/ need this.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const withBase = (path: string) => `${BASE_PATH}${path}`;
