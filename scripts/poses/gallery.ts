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
import * as THREE from 'three';
import { bonesOf, type Angles, type Bones, type Quat } from '../../lib/pose';
import type { JointName } from '../../lib/types';

type Group = (typeof POSE_GROUPS)[number];
/** Each drawing's group, name and description (by hand, from the gallery's own category and name and the drawings): [group, name, description]. */
const TEXT = JSON.parse(readFileSync(new URL('./gallery-text.json', import.meta.url), 'utf8')) as Record<string, [Group, string, string]>;

const fused = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, { world: number[][]; views: string[]; rms: number }>;
const m = new Mannequin(new Ink(), DEFAULT_BODY, '', true);

/**
 * Left out on review: still made wrong (a leg read as kicking or lifted, a body read as standing
 * or lying when it is not). Their names and descriptions stay in gallery-text.json, to be made
 * again by hand from them.
 */
const SKIP = new Set<string>([
  'full_single_P005', 'full_single_P012', 'full_single_P016', 'full_single_P069',
  'full_sexy_P006', 'full_sexy_P010', 'full_sexy_P011', 'full_sexy_P013', 'full_sexy_P028',
  'full_sexy_P052', 'full_sexy_P061', 'full_sexy_P072', 'full_sexy_P075',
]);

/*
 * Legs folded under the body (kneeling, squatting, sitting on or between the heels, the legs
 * swept to one side) the drawings give badly: MediaPipe reads a folded leg as one standing or
 * kicking. Those poses take their legs (and hips) from a template instead, the body above kept
 * as it was in the world (its spine turned by what the hips were turned).
 */
type Fold = 'kneel' | 'heels' | 'wide' | 'between' | 'squat' | 'sideL' | 'sideR';
const leg = (thigh: [number, number, number], knee: number, foot: number): Angles => ({
  leftUpperLeg: thigh, leftLowerLeg: [knee, 0, 0], leftFoot: [foot, 0, 0],
  rightUpperLeg: [thigh[0], -thigh[1], -thigh[2]], rightLowerLeg: [knee, 0, 0], rightFoot: [foot, 0, 0],
});
const SIDE_L: Angles = {
  hips: [0, 20, 8],
  leftUpperLeg: [-85, -60, 10], leftLowerLeg: [140, 0, 0], leftFoot: [40, 0, 0], rightUpperLeg: [-75, -70, -5], rightLowerLeg: [150, 0, 0], rightFoot: [40, 0, 0],
};
const FOLDS: Record<Fold, Angles> = {
  kneel: leg([-5, 0, 6], 95, 75),
  heels: leg([-75, 0, 6], 160, 70),
  wide: { ...leg([-30, 0, 25], 140, 70) },
  between: leg([-85, 35, 5], 160, 60),
  squat: { hips: [15, 0, 0], ...leg([-120, 0, 8], 150, -20) },
  sideL: SIDE_L,
  sideR: Object.fromEntries(Object.entries(SIDE_L).map(([j, [x, y, z]]) => [j.startsWith('left') ? j.replace('left', 'right') : j.startsWith('right') ? j.replace('right', 'left') : j, [x, -y, -z]])) as Angles,
};
const FOLD: Record<string, Fold> = {
  ...Object.fromEntries(['full_single_P031', 'full_single_P032', 'full_single_P034', 'full_single_P035', 'full_single_P036', 'full_single_P038', 'full_single_P039', 'full_single_P040', 'full_single_P074',
    'full_sexy_P031', 'full_sexy_P038', 'full_sexy_P039', 'full_sexy_P043', 'full_sexy_P044', 'full_sexy_P045', 'full_sexy_P077'].map((k) => [k, 'kneel'])),
  ...Object.fromEntries(['full_sexy_P017', 'full_sexy_P034', 'full_single_P078'].map((k) => [k, 'heels'])),
  ...Object.fromEntries(['full_sexy_P033', 'full_sexy_P036', 'full_sexy_P037', 'full_sexy_P042'].map((k) => [k, 'wide'])),
  ...Object.fromEntries(['full_single_P041', 'full_single_P042', 'full_single_P043', 'full_single_P044', 'full_single_P048', 'full_sexy_P027'].map((k) => [k, 'between'])),
  ...Object.fromEntries(['full_single_P061', 'full_single_P062', 'full_single_P063', 'full_single_P064', 'full_single_P065', 'full_single_P066'].map((k) => [k, 'squat'])),
  ...Object.fromEntries(['full_sexy_P016', 'full_sexy_P026', 'full_single_P046', 'full_single_P047', 'full_single_P079'].map((k) => [k, 'sideL'])),
  full_single_P045: 'sideR',
};
const LEGS: JointName[] = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

/** The pose with its legs and hips folded as the template has them, the spine (and all above it) as it was in the world. */
function folded(bones: Bones, fold: Fold): Bones {
  const t = bonesOf(FOLDS[fold]);
  const q = (b: Quat | undefined) => (b ? new THREE.Quaternion().fromArray(b) : new THREE.Quaternion());
  let spine = q(t.hips).invert().multiply(q(bones.hips)).multiply(q(bones.spine));
  // (A body above lying over, as it was read with the legs wrong: as it was on the hips instead.)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q(t.hips).multiply(spine));
  if (up.y < Math.cos(THREE.MathUtils.degToRad(55))) spine = q(bones.spine);
  return { ...bones, hips: t.hips, spine: spine.toArray() as Quat, ...Object.fromEntries(LEGS.map((j) => [j, t[j]])) };
}

const out: { id: string; name: string; description: string; group: Group; bones: Bones; view: { yaw: number; pitch: number; fov: number } }[] = [];
for (const [key, f] of Object.entries(fused)) {
  if (SKIP.has(key)) continue;
  const lm = fromMediaPipe(f.world.map(([x, y, z, visibility]) => ({ x, y, z, visibility })));
  const { bones } = retarget(m, lm);
  // Stood on the floor facing forward, as the library keeps poses (folded facing forward: the spine keeps no turn of the hips').
  const facing = withFacing({ ...newFigure(), bones }, 0);
  const figure = FOLD[key] ? withFacing({ ...facing, bones: folded(facing.bones, FOLD[key]) }, 0) : facing;
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
