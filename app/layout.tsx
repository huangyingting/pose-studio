import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter_Tight } from 'next/font/google';
import { contentSecurityPolicy } from '@/lib/csp';
import './globals.css';

// Self-hosted at build time by next/font (no requests to Google at runtime). Inter Tight: Inter's
// letters set closer, a size up for the width Inter's took.
const sans = Inter_Tight({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Film Studio — block, act and film scenes with posable 3D people',
  description: 'Pose 3D people by dragging hands and feet, put them in a set, make them act and film them in shots; export reference sheets, storyboards and video.',
  applicationName: 'Film Studio',
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
