import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import { contentSecurityPolicy } from '@/lib/csp';
import './globals.css';

// Self-hosted at build time by next/font (no requests to Google at runtime).
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

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
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {metaCsp && <head><meta httpEquiv="Content-Security-Policy" content={metaCsp} /></head>}
      <body>{children}</body>
    </html>
  );
}
