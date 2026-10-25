import type { Metadata, Viewport } from 'next';
import { contentSecurityPolicy } from '@/lib/csp';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pose Studio — posable mannequin for drawing reference',
  description: 'Pose a 3D art mannequin by dragging hands and feet, then export clean line-art reference sheets.',
  applicationName: 'Pose Studio',
};

// Static hosts (e.g. GitHub Pages) cannot send the CSP header, so static exports carry it as a <meta> tag.
const metaCsp = process.env.NEXT_OUTPUT === 'export' ? contentSecurityPolicy({ meta: true }) : null;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f6bed',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {metaCsp && <head><meta httpEquiv="Content-Security-Policy" content={metaCsp} /></head>}
      <body>{children}</body>
    </html>
  );
}
