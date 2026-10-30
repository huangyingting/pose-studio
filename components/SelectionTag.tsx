'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Selection } from '@/lib/types';

/** A tag's colour by what is selected (as its handles are coloured): a figure, a prop, a camera, a light. */
const COLOURS: Partial<Record<NonNullable<Selection>['kind'], string>> = { figure: '#3b6cff', prop: '#0d9488', camera: '#7c3aed', light: '#d97706' };

/** Its height in the scene (m): it grows and shrinks with the view, as the handles do. */
const HEIGHT = 0.075;
/** The picture's scale: pixels per CSS pixel of a tag about 20 px high. */
const PX = 4;

/** The tag's picture: the name in white on the colour, a darker rim round it. */
function draw(text: string, colour: string) {
  const font = `600 ${11.5 * PX}px ${getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'}`;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  g.font = font;
  const [h, pad, rim] = [21 * PX, 9 * PX, 1.5 * PX];
  canvas.width = Math.ceil(g.measureText(text).width + 2 * pad);
  canvas.height = h;
  g.font = font;
  const r = h / 2 - rim / 2;
  g.beginPath();
  g.roundRect(rim / 2, rim / 2, canvas.width - rim, h - rim, r);
  g.fillStyle = colour;
  g.fill();
  g.lineWidth = rim;
  g.strokeStyle = `#${new THREE.Color(colour).multiplyScalar(0.62).getHexString()}`;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, h / 2 + PX * 0.5);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, aspect: canvas.width / canvas.height };
}

/**
 * What is selected, named in the scene just above it: a tag in its colour, facing the view, sized
 * in the scene (nearer, larger), drawn over what is in front of it (as the gizmo is).
 */
export default function SelectionTag({ selection, text, at }: { selection: Selection; text: string | null; at(sel: NonNullable<Selection>): THREE.Vector3 | null }) {
  const sprite = useRef<THREE.Sprite>(null);
  const colour = (selection && COLOURS[selection.kind]) ?? COLOURS.figure!;
  const tag = useMemo(() => {
    if (!text) return null;
    const { map, aspect } = draw(text, colour);
    return { aspect, material: new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }) };
  }, [text, colour]);
  useEffect(() => () => { tag?.material.map?.dispose(); tag?.material.dispose(); }, [tag]);
  useFrame(() => {
    const s = sprite.current;
    if (!s) return;
    const p = selection && tag ? at(selection) : null;
    s.visible = !!p;
    if (!p) return;
    s.position.copy(p);
    s.scale.set(HEIGHT * tag!.aspect, HEIGHT, 1);
  });
  if (!tag) return null;
  // (Its foot a little above the point: clear of the head, the prop's top, the lamp.)
  return <sprite ref={sprite} material={tag.material} center={[0.5, -0.35]} renderOrder={1000} raycast={() => {}} />;
}
