/*
 * The gallery poses (lib/gallery-poses.json): full-body pose drawings made library poses.
 *
 *     python3 -I scripts/poses/prepare.py <drawings dir> /tmp/gal     (line art made photo-like)
 *     node scripts/poses/detect.mjs /tmp/gal /tmp/landmarks.json       (MediaPipe on every view)
 *     python3 -I scripts/poses/fuse.py /tmp/landmarks.json /tmp/fused.json   (a pose's level views made one)
 *     npx jiti scripts/poses/gallery.ts /tmp/fused.json                (this: lib/gallery-poses.json)
 *
 * Each pose's fused landmarks are retargeted onto the mannequin (lib/retarget.ts, as a photo is),
 * stood up facing forward, sorted into the library's groups by what the body rests on, and named
 * by its group and what its arms do.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { DEFAULT_BODY } from '../../lib/body';
import { newFigure } from '../../lib/doc';
import { Ink } from '../../lib/ink';
import { legsOf } from '../../lib/locomotion';
import { Mannequin } from '../../lib/mannequin';
import { withFacing } from '../../lib/relations';
import { fromMediaPipe, retarget } from '../../lib/retarget';
import type { Bones } from '../../lib/pose';
import type { JointName } from '../../lib/types';

type Group = 'Standing' | 'Sitting & squatting' | 'Kneeling & all fours' | 'Lying';
const WORD: Record<Group, string> = { Standing: 'Standing', 'Sitting & squatting': 'Sitting', 'Kneeling & all fours': 'Kneeling', Lying: 'Lying' };

const fused = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, { world: number[][]; views: string[]; rms: number }>;
const m = new Mannequin(new Ink(), DEFAULT_BODY, '', true);
/** Hips above the floor standing (m). */
const STAND = legsOf(DEFAULT_BODY).rootY;
const at = (j: JointName) => m.joints[j].getWorldPosition(new THREE.Vector3());

/** Where the body rests: lying (the trunk level), kneeling (a knee down, hips up), sitting (hips low), or standing. */
function groupOf(): Group {
  const hips = at('hips');
  const up = at('neck').sub(hips).normalize();
  const floor = Math.min(at('leftFoot').y, at('rightFoot').y, at('leftLowerLeg').y, at('rightLowerLeg').y);
  const height = hips.y - floor;
  if (Math.abs(up.y) < 0.5 && height < 0.45) return 'Lying';
  const knee = Math.min(at('leftLowerLeg').y, at('rightLowerLeg').y) - floor;
  if (knee < 0.12 && height > 0.35) return 'Kneeling & all fours';
  if (height < STAND * 0.62) return 'Sitting & squatting';
  return 'Standing';
}

/** What the arms do, in a few words (or nothing much). */
function armsOf(): string {
  const head = at('head').add(new THREE.Vector3(0, 0.1, 0));
  const top = head.y + 0.05;
  const wrist = (s: 'left' | 'right') => at(`${s}Hand`);
  const [l, r] = [wrist('left'), wrist('right')];
  const hip = (s: 'left' | 'right') => at(`${s}UpperLeg`).add(new THREE.Vector3(s === 'left' ? 0.08 : -0.08, 0.05, 0));
  const floor = Math.min(at('leftFoot').y, at('rightFoot').y, at('hips').y);
  const onHead = (w: THREE.Vector3) => w.distanceTo(head) < 0.22;
  const onHip = (w: THREE.Vector3, s: 'left' | 'right') => w.distanceTo(hip(s)) < 0.17;
  const down = (w: THREE.Vector3) => w.y - floor < 0.12;
  if (l.y > top && r.y > top) return 'arms up';
  if (onHead(l) && onHead(r)) return 'hands on head';
  if (onHip(l, 'left') && onHip(r, 'right')) return 'hands on hips';
  if (down(l) && down(r)) return 'leaning on hands';
  if (l.y > top || r.y > top) return 'arm raised';
  if (onHead(l) || onHead(r)) return 'hand on head';
  if (onHip(l, 'left') || onHip(r, 'right')) return 'hand on hip';
  if (down(l) || down(r)) return 'leaning on a hand';
  return '';
}

/**
 * Left out on review: reconstructed wrong (a seated or kneeling figure stood up, as the drawing
 * from the front gives no depth; seen from above; upside down).
 */
const SKIP = new Set([
  'full_sexy_P023', 'full_sexy_P027', 'full_sexy_P028', 'full_sexy_P030', 'full_sexy_P032',
  'full_sexy_P042', 'full_sexy_P043', 'full_sexy_P045', 'full_sexy_P054', 'full_sexy_P055',
  'full_sexy_P060', 'full_sexy_P061', 'full_sexy_P064', 'full_sexy_P066', 'full_sexy_P073',
  'full_sexy_P074', 'full_sexy_P076', 'full_sexy_P078', 'full_sexy_P079', 'full_single_P002',
  'full_single_P003', 'full_single_P004', 'full_single_P005', 'full_single_P008',
  'full_single_P010', 'full_single_P011', 'full_single_P013', 'full_single_P031',
  'full_single_P032', 'full_single_P033', 'full_single_P034', 'full_single_P038',
  'full_single_P040', 'full_single_P042', 'full_single_P043', 'full_single_P045',
  'full_single_P046', 'full_single_P047', 'full_single_P049', 'full_single_P051',
  'full_single_P056', 'full_single_P058', 'full_single_P059', 'full_single_P065',
  'full_single_P074',
]);

const out: { id: string; name: string; group: Group; bones: Bones; view: { yaw: number; pitch: number; fov: number } }[] = [];
const taken = new Map<string, number>();
for (const [key, f] of Object.entries(fused)) {
  if (SKIP.has(key)) continue;
  const lm = fromMediaPipe(f.world.map(([x, y, z, visibility]) => ({ x, y, z, visibility })));
  const { bones } = retarget(m, lm);
  // Stood on the floor facing forward, as the library keeps poses.
  const figure = withFacing({ ...newFigure(), bones }, 0);
  m.apply(figure);
  m.object.updateMatrixWorld(true);
  const group = groupOf();
  const arms = armsOf();
  const base = arms ? `${WORD[group]}, ${arms}` : WORD[group];
  const n = (taken.get(base) ?? 0) + 1;
  taken.set(base, n);
  const round = (q: number[] | undefined) => q?.map((v) => Math.round(v * 1e4) / 1e4);
  out.push({
    // (By its drawing: set and number.)
    id: `gallery-${key.replace(/^full_single_/, 'a-').replace(/^full_sexy_/, 'b-').toLowerCase()}`,
    name: n > 1 ? `${base} ${n}` : base,
    group,
    bones: Object.fromEntries(Object.entries(figure.bones).map(([j, q]) => [j, round(q)])) as Bones,
    // (Lying ones seen a little from above.)
    view: group === 'Lying' ? { yaw: 20, pitch: 30, fov: 20 } : { yaw: 15, pitch: 6, fov: 20 },
  });
}
// The first of a name gets a number too, where there are more.
for (const p of out) if (taken.get(p.name)! > 1) p.name = `${p.name} 1`;
out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
writeFileSync('lib/gallery-poses.json', JSON.stringify(out));
const count = (g: Group) => out.filter((p) => p.group === g).length;
console.log(`${out.length} poses: ${(Object.keys(WORD) as Group[]).map((g) => `${count(g)} ${WORD[g].toLowerCase()}`).join(', ')}`);
