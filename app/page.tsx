'use client';

import dynamic from 'next/dynamic';

// three.js needs the browser (WebGL, localStorage), so skip server rendering.
const Studio = dynamic(() => import('@/components/Studio'), {
  ssr: false,
  loading: () => <div className="loading">Loading Pose Studio…</div>,
});

export default function Page() {
  return <Studio />;
}
