import { withBase } from './paths';
import { BONES as SKELETON, type ModelInfo } from './types';

/*
 * Characters that come with the app (public/characters: see CREDITS.txt there): listed
 * with the mannequin, their files fetched the first time a figure is drawn as one (or one is
 * previewed). Scenes refer to them by a stable id, as built-in motions are, so a scene drawn with
 * one opens anywhere without carrying the file.
 */

const PREFIX = 'character:';

// Their skeleton (Unreal-style names), found by mapBones without help.
const side = (s: 'l' | 'r', L: 'left' | 'right') => ({
  [`${L}Shoulder`]: `clavicle_${s}`, [`${L}UpperArm`]: `upperarm_${s}`, [`${L}LowerArm`]: `lowerarm_${s}`, [`${L}Hand`]: `hand_${s}`,
  [`${L}UpperLeg`]: `thigh_${s}`, [`${L}LowerLeg`]: `calf_${s}`, [`${L}Foot`]: `foot_${s}`, [`${L}Toes`]: `ball_${s}`,
  ...Object.fromEntries((['Index', 'Middle', 'Ring', 'Little'] as const).flatMap((f) => {
    const n = { Index: 'index', Middle: 'middle', Ring: 'ring', Little: 'pinky' }[f];
    return [[`${L}${f}Proximal`, `${n}_01_${s}`], [`${L}${f}Intermediate`, `${n}_02_${s}`], [`${L}${f}Distal`, `${n}_03_${s}`]];
  })),
  [`${L}ThumbMetacarpal`]: `thumb_01_${s}`, [`${L}ThumbProximal`]: `thumb_02_${s}`, [`${L}ThumbDistal`]: `thumb_03_${s}`,
});
// MakeHuman's (Mixamo names, as MPFB rigs them).
const mixamoSide = (S: 'Left' | 'Right', L: 'left' | 'right') => ({
  [`${L}Shoulder`]: `mixamorig${S}Shoulder`, [`${L}UpperArm`]: `mixamorig${S}Arm`, [`${L}LowerArm`]: `mixamorig${S}ForeArm`, [`${L}Hand`]: `mixamorig${S}Hand`,
  [`${L}UpperLeg`]: `mixamorig${S}UpLeg`, [`${L}LowerLeg`]: `mixamorig${S}Leg`, [`${L}Foot`]: `mixamorig${S}Foot`, [`${L}Toes`]: `mixamorig${S}ToeBase`,
  ...Object.fromEntries((['Index', 'Middle', 'Ring', 'Little', 'Thumb'] as const).flatMap((f) => {
    const n = f === 'Little' ? 'Pinky' : f;
    const joints = f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    return joints.map((j, k) => [`${L}${f}${j}`, `mixamorig${S}Hand${n}${k + 1}`]);
  })),
});
const MIXAMO: ModelInfo['bones'] = {
  hips: 'mixamorigHips', spine: 'mixamorigSpine', chest: 'mixamorigSpine1', upperChest: 'mixamorigSpine2', neck: 'mixamorigNeck', head: 'mixamorigHead',
  ...mixamoSide('Left', 'left'), ...mixamoSide('Right', 'right'),
};

const BONES: ModelInfo['bones'] = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'Head',
  ...side('l', 'left'), ...side('r', 'right'),
};

// A VRM avatar made one of ours (scripts/vrm-character.py): its bones named as our skeleton's.
const OURS: ModelInfo['bones'] = Object.fromEntries(SKELETON.map((b) => [b, b]));

/**
 * The built-in characters: a man and a woman (Quaternius, Universal Base Characters); a child, a
 * heavier man and an older woman (MakeHuman, shaped with MPFB), all CC0; Aoi, an anime avatar in
 * her own toon look (Ueda's VRM, credited as her licence asks), and Mio, Aoi made over. Each with the body the mannequin
 * under it takes (its height, build, head and legs, measured from the character), which contacts
 * and the motion check use.
 */
export const BUILT_IN_CHARACTERS: ModelInfo[] = [
  { id: `${PREFIX}woman`, name: 'Woman', format: 'glb', bones: BONES, body: { sex: 1, height: 1.77, build: 0.25, head: 1.05, legs: 0.95, bust: 0.4 } },
  { id: `${PREFIX}man`, name: 'Man', format: 'glb', bones: BONES, body: { sex: 0, height: 1.82, build: 0.65, head: 0.96, legs: 0.9, bust: 0 } },
  { id: `${PREFIX}child`, name: 'Child', format: 'glb', bones: MIXAMO, body: { sex: 0.5, height: 1.31, build: 0.3, head: 1.19, legs: 1, bust: 0 } },
  { id: `${PREFIX}heavy-man`, name: 'Heavier man', format: 'glb', bones: MIXAMO, body: { sex: 0, height: 1.73, build: 0.8, head: 1.05, legs: 1.05, bust: 0 } },
  { id: `${PREFIX}older-woman`, name: 'Older woman', format: 'glb', bones: MIXAMO, body: { sex: 1, height: 1.52, build: 0.5, head: 1.05, legs: 1, bust: 0.5 } },
  {
    id: `${PREFIX}aoi`, name: 'Aoi', format: 'glb', bones: OURS, body: { sex: 1, height: 1.55, build: 0, head: 1.27, legs: 1.13, bust: 0.3 },
    credit: 'by Ueda · personal use · credit required',
  },
  // (Aoi made over: silver hair, grey-green eyes, a white bikini: scripts/characters/mio.py.)
  {
    id: `${PREFIX}mio`, name: 'Mio', format: 'glb', bones: OURS, body: { sex: 1, height: 1.55, build: 0, head: 1.27, legs: 1.13, bust: 0.3 },
    credit: 'after Aoi by Ueda · personal use · credit required',
  },
];

export const isBuiltInCharacter = (id: string) => id.startsWith(PREFIX);

/** Where a built-in character's file is. */
export const characterFile = (id: string) => withBase(`/characters/${id.slice(PREFIX.length)}.glb`);

/** Its thumbnail, which comes with the app (drawing it would mean fetching its file). */
export const characterImage = (id: string) => withBase(`/characters/${id.slice(PREFIX.length)}.png`);
