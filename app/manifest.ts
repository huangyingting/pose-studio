import type { MetadataRoute } from 'next';

// Generated at build time (required for static exports).
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Film Studio',
    short_name: 'Film Studio',
    description: 'Block, act and film scenes with posable 3D people',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f4f4f3',
    theme_color: '#ffffff',
    // URLs are relative to the manifest's own URL, so they also work under a base path.
    icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
