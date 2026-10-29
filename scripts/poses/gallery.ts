/*
 * The gallery poses (lib/gallery-poses.json): full-body pose drawings made library poses.
 *
 *     python3 -I scripts/poses/prepare.py <drawings dir> /tmp/gal     (line art made photo-like)
 *     node scripts/poses/detect.mjs /tmp/gal /tmp/landmarks.json       (MediaPipe on every view)
 *     python3 -I scripts/poses/fuse.py /tmp/landmarks.json /tmp/fused.json   (a pose's level views made one)
 *     npx jiti scripts/poses/gallery.ts /tmp/fused.json                (this: lib/gallery-poses.json)
 *
 * Each pose's fused landmarks are retargeted onto the mannequin (lib/retarget.ts, as a photo is),
 * stood up facing forward, and given its group, name and description from gallery-text.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_BODY } from '../../lib/body';
import { newFigure } from '../../lib/doc';
import { Ink } from '../../lib/ink';
import { Mannequin } from '../../lib/mannequin';
import { POSE_GROUPS } from '../../lib/presets';
import { withFacing } from '../../lib/relations';
import { fromMediaPipe, retarget } from '../../lib/retarget';
import type { Bones } from '../../lib/pose';

type Group = (typeof POSE_GROUPS)[number];
/** Each drawing's group, name and description (by hand, from the gallery's own category and name and the drawings): [group, name, description]. */
const TEXT = JSON.parse(readFileSync(new URL('./gallery-text.json', import.meta.url), 'utf8')) as Record<string, [Group, string, string]>;

const fused = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, { world: number[][]; views: string[]; rms: number }>;
const m = new Mannequin(new Ink(), DEFAULT_BODY, '', true);

/**
 * Left out on review: reconstructed wrong (a seated or kneeling figure stood up, as the drawing
 * from the front gives no depth; seen from above; upside down).
 */
const SKIP = new Set<string>([
]);

const out: { id: string; name: string; description: string; group: Group; bones: Bones; view: { yaw: number; pitch: number; fov: number } }[] = [];
for (const [key, f] of Object.entries(fused)) {
  if (SKIP.has(key)) continue;
  const lm = fromMediaPipe(f.world.map(([x, y, z, visibility]) => ({ x, y, z, visibility })));
  const { bones } = retarget(m, lm);
  // Stood on the floor facing forward, as the library keeps poses.
  const figure = withFacing({ ...newFigure(), bones }, 0);
  const [group, name, description] = TEXT[key];
  const round = (q: number[] | undefined) => q?.map((v) => Math.round(v * 1e4) / 1e4);
  out.push({
    // (By its drawing: set and number.)
    id: `gallery-${key.replace(/^full_single_/, 'a-').replace(/^full_sexy_/, 'b-').toLowerCase()}`,
    name,
    description,
    group,
    bones: Object.fromEntries(Object.entries(figure.bones).map(([j, q]) => [j, round(q)])) as Bones,
    // (Lying ones seen a little from above.)
    view: group === 'Lying' ? { yaw: 20, pitch: 30, fov: 20 } : { yaw: 15, pitch: 6, fov: 20 },
  });
}
// (In the drawings' order: each set's numbers.)
out.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync('lib/gallery-poses.json', JSON.stringify(out));
const count = (g: Group) => out.filter((p) => p.group === g).length;
console.log(`${out.length} poses: ${POSE_GROUPS.map((g) => `${count(g)} ${g.toLowerCase()}`).join(', ')}`);
