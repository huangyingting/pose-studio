import type { NextConfig } from 'next';
import { contentSecurityPolicy } from './lib/csp';

/*
 * NEXT_OUTPUT selects the kind of build:
 *   (unset)      server for `next start`
 *   standalone   self-contained server bundle for the Docker image (set in the Dockerfile)
 *   export       static files in out/ for any static host (GitHub Pages: .github/workflows/pages.yml)
 * NEXT_PUBLIC_BASE_PATH serves the app from a sub-path, e.g. "/pose-studio".
 *
 * Two editions come out of the same code:
 *   static   the export: everything runs in the browser, no accounts and no AI
 *   server   everything else: sign-in (NextAuth), library sync (Prisma, SQLite) and the AI assistant
 * Server-only route handlers are named `route.server.ts`; static exports leave them out.
 */
const output = process.env.NEXT_OUTPUT;
const staticExport = output === 'export';
const edition = staticExport ? 'static' : 'server';

const csp = contentSecurityPolicy({ dev: process.env.NODE_ENV !== 'production' });

const nextConfig: NextConfig = {
  // The dev badge sits on top of the pose library's footer buttons.
  devIndicators: false,
  output: staticExport ? 'export' : output === 'standalone' ? 'standalone' : undefined,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  poweredByHeader: false,
  pageExtensions: edition === 'server' ? ['server.ts', 'tsx', 'ts'] : ['tsx', 'ts'],
  // Which build this is (what a browser keeps from one, the library's thumbnails, is drawn again for
  // the next); none while developing (code changes without a new build: nothing kept).
  env: { NEXT_PUBLIC_BUILD: process.env.GITHUB_SHA ?? (process.env.NODE_ENV === 'production' ? String(Date.now()) : '') },
  turbopack: {
    resolveAlias: { '@edition/server': edition === 'server' ? './components/server/index.ts' : './components/server/none.ts' },
  },
  // Static hosts cannot be told to send headers; the CSP becomes a <meta> tag instead (app/layout.tsx).
  ...(staticExport ? {} : { headers }),
};

async function headers() {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        // Ignored by browsers on plain HTTP; enforces HTTPS once served over TLS.
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      ],
    },
    {
      // The service worker must always be revalidated so updates roll out promptly.
      source: '/sw.js',
      headers: [{ key: 'Cache-Control', value: 'no-cache' }],
    },
    {
      source: '/mediapipe/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ];
}

export default nextConfig;
