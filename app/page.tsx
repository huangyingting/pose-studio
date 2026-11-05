'use client';

import dynamic from 'next/dynamic';

// three.js needs the browser (WebGL, localStorage), so skip server rendering.
// (The mannequin's meshes fetched beside the studio's code: every figure is made from them.)
const Studio = dynamic(async () => {
  const [{ default: studio }] = await Promise.all([import('@/components/Studio'), import('@/lib/mannequin').then((m) => m.loadBots())]);
  return studio;
}, {
  ssr: false,
  loading: () => <div className="loading">Loading Film Studio…</div>,
});

export default function Page() {
  return <Studio />;
}
