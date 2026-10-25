import type { MetadataRoute } from 'next';

// Generated at build time (required for static exports).
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pose Studio',
    short_name: 'Pose Studio',
    description: 'Posable 3D mannequin for drawing reference',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f5f5f7',
    theme_color: '#4f6bed',
    // URLs are relative to the manifest's own URL, so they also work under a base path.
    icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
