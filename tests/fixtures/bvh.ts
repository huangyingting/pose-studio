/* A small BVH skeleton and motion for testing motion import (unit and end-to-end). */

/** Names for one skeleton in two rigs' conventions. */
export const CMU = {
  hips: 'Hips', spine: 'Spine', neck: 'Neck', head: 'Head',
  upLeg: (s: string) => `${s}UpLeg`, leg: (s: string) => `${s}Leg`, foot: (s: string) => `${s}Foot`, toe: (s: string) => `${s}ToeBase`,
  clav: (s: string) => `${s}Shoulder`, arm: (s: string) => `${s}Arm`, fore: (s: string) => `${s}ForeArm`, hand: (s: string) => `${s}Hand`,
  side: { L: 'Left', R: 'Right' },
};
export const UNREAL = {
  hips: 'pelvis', spine: 'spine_01', neck: 'neck_01', head: 'head',
  upLeg: (s: string) => `thigh_${s}`, leg: (s: string) => `calf_${s}`, foot: (s: string) => `foot_${s}`, toe: (s: string) => `ball_${s}`,
  clav: (s: string) => `clavicle_${s}`, arm: (s: string) => `upperarm_${s}`, fore: (s: string) => `lowerarm_${s}`, hand: (s: string) => `hand_${s}`,
  side: { L: 'l', R: 'r' },
};

/**
 * A T-posed skeleton in centimetres facing +Z, three frames 0.1 s apart: standing, then a step
 * forward with the left foot. The right foot stays planted (its leg tilts back as the hips go
 * ahead and dip), the left swings through off the floor and lands 80 cm ahead, the hips 40 cm.
 */
export function bvh(n: typeof CMU): string {
  const joint = (name: string, offset: string, inner: string) => `JOINT ${name}\n{\nOFFSET ${offset}\nCHANNELS 3 Zrotation Xrotation Yrotation\n${inner}}\n`;
  const end = (offset: string) => `End Site\n{\nOFFSET ${offset}\n}\n`;
  const leg = (s: 'L' | 'R', x: number) =>
    joint(n.upLeg(n.side[s]), `${x} -5 0`, joint(n.leg(n.side[s]), '0 -42 0', joint(n.foot(n.side[s]), '0 -42 0', joint(n.toe(n.side[s]), '0 -8 12', end('0 0 5')))));
  const arm = (s: 'L' | 'R', x: number) =>
    joint(n.clav(n.side[s]), `${x * 3} 0 0`, joint(n.arm(n.side[s]), `${x * 14} 0 0`, joint(n.fore(n.side[s]), `${x * 28} 0 0`, joint(n.hand(n.side[s]), `${x * 25} 0 0`, end(`${x * 15} 0 0`)))));
  const hierarchy = `HIERARCHY\nROOT ${n.hips}\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n${leg('L', 9)}${leg('R', -9)}${joint(n.spine, '0 10 0', joint(n.neck, '0 45 0', joint(n.head, '0 10 0', end('0 18 0')) + arm('L', 1) + arm('R', -1)))}}\n`;
  // Channels: hips (6), then per joint 3, in hierarchy order.
  const order = hierarchy.match(/(ROOT|JOINT) \S+/g)!.map((s) => s.split(' ')[1]);
  const frame = (hips: number[], turns: Record<string, number[]>) =>
    [...hips, 0, 0, 0, ...order.slice(1).flatMap((j) => turns[j] ?? [0, 0, 0])].join(' ');
  // Channels are Z, X, Y: an X turn of −θ swings a leg forward, +θ back (and bends a knee).
  const swinging = { [n.upLeg(n.side.R)]: [0, 13.4, 0], [n.upLeg(n.side.L)]: [0, -30, 0], [n.leg(n.side.L)]: [0, 40, 0] };
  const landed = { [n.upLeg(n.side.R)]: [0, 28.4, 0], [n.upLeg(n.side.L)]: [0, -28.4, 0] };
  const motion = ['MOTION', 'Frames: 3', 'Frame Time: 0.1',
    frame([0, 92, 0], {}), frame([0, 89.7, 20], swinging), frame([0, 81.9, 40], landed)].join('\n');
  return `${hierarchy}${motion}\n`;
}
