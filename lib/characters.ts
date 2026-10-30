import { withBase } from './paths';
import { BONES as SKELETON, type BodyParams, type ModelInfo } from './types';

/*
 * Characters that come with the app (public/characters: see CREDITS.txt there): listed
 * with the mannequin, their files fetched the first time a figure is drawn as one (or one is
 * previewed). Scenes refer to them by a stable id, as built-in motions are, so a scene drawn with
 * one opens anywhere without carrying the file.
 */

const PREFIX = 'character:';
/** The files' version: raised when one is remade, so that a browser does not keep the old one. */
const FILES = 11;

// A VRM avatar, a MakeHuman, Mixamo or Sketchfab character made one of ours (scripts/vrm-character.py,
// scripts/characters/import.ts): its bones named as our skeleton's (some without a finger's end).
const OURS: ModelInfo['bones'] = Object.fromEntries(SKELETON.map((b) => [b, b]));
const oursWithout = (...lacks: string[]): ModelInfo['bones'] => Object.fromEntries(SKELETON.filter((b) => !lacks.includes(b)).map((b) => [b, b]));

const makehuman = (id: string, name: string, body: BodyParams): ModelInfo => ({ id: `${PREFIX}${id}`, name, format: 'glb', bones: OURS, body, credit: 'MakeHuman · CC0' });
const mixamo = (id: string, name: string, body: BodyParams, bones = OURS): ModelInfo => ({ id: `${PREFIX}${id}`, name, format: 'glb', bones, body, credit: 'by Adobe Mixamo' });
// A figure that came as a mesh only, rigged as ours (scripts/characters/rig.py): its hands and feet whole.
const WHOLE_HANDS = oursWithout(...SKELETON.filter((b) => /Thumb|Index|Middle|Ring|Little|Toes/.test(b)));
const sketchfab = (id: string, name: string, body: BodyParams, author: string): ModelInfo => ({ id: `${PREFIX}${id}`, name, format: 'glb', bones: WHOLE_HANDS, body, credit: `by ${author} · CC BY 4.0` });

/**
 * The built-in characters: a man, a woman and women in dresses made with MakeHuman (Chinese, slender,
 * ideal proportions, faces found beautiful in China, in fitted clothes: scripts/characters/makehuman.py),
 * CC0; Aoi, an anime avatar in
 * her own toon look (Ueda's VRM, credited as her licence asks); ten of Mixamo's characters
 * (natural proportions, and a barbarian), named by their roles, in their own colours (Adobe's);
 * one of Sketchfab's (CC BY), rigged here. Each with the body the mannequin under it takes (its
 * sex, and the height that puts the mannequin's hips at the character's), which contacts and the
 * motion check use.
 */
export const BUILT_IN_CHARACTERS: ModelInfo[] = [
  makehuman('woman', 'Woman', { sex: 1, height: 1.71 }),
  makehuman('man', 'Man', { sex: 0, height: 1.93 }),
  // Women in dresses (after the looks of a costume gallery).
  makehuman('qipao', 'Qipao', { sex: 1, height: 1.7 }),
  makehuman('satin-dress', 'Satin dress', { sex: 1, height: 1.7 }),
  makehuman('party-dress', 'Party dress', { sex: 1, height: 1.7 }),
  makehuman('office', 'Office lady', { sex: 1, height: 1.7 }),
  {
    id: `${PREFIX}aoi`, name: 'Aoi', format: 'glb', bones: OURS, body: { sex: 1, height: 1.49 },
    credit: 'by Ueda · personal use · credit required',
  },
  // Adobe's Mixamo characters, in their own colours in the Toon style (scripts/characters/import.ts).
  mixamo('adam', 'Jogger', { sex: 0, height: 1.72 }),
  mixamo('brute', 'Barbarian', { sex: 0, height: 2.14 }),
  mixamo('elizabeth', 'Casual woman', { sex: 1, height: 1.58 }),
  mixamo('erika-archer', 'Archer', { sex: 1, height: 1.79 }),
  mixamo('joe', 'Businessman', { sex: 0, height: 1.75 }),
  mixamo('ninja', 'Ninja', { sex: 0, height: 1.64 }),
  mixamo('paladin-j-nordstrom', 'Knight', { sex: 0, height: 1.69 }),
  mixamo('pete', 'Construction worker', { sex: 0, height: 1.69 }),
  mixamo('remy', 'Student', { sex: 0, height: 1.86 }),
  mixamo('swat', 'SWAT officer', { sex: 0, height: 1.7 }),
  // Sketchfab's, CC BY (scripts/characters/rig.py, then import.ts): a life model.
  sketchfab('male-base', 'Life model', { sex: 0, height: 1.81 }, 'Mandrake'),
];

export const isBuiltInCharacter = (id: string) => id.startsWith(PREFIX);

/** Where a built-in character's file is. */
export const characterFile = (id: string) => withBase(`/characters/${id.slice(PREFIX.length)}.glb?v=${FILES}`);

/** Its thumbnail, which comes with the app (drawing it would mean fetching its file). */
export const characterImage = (id: string) => withBase(`/characters/${id.slice(PREFIX.length)}.png?v=${FILES}`);
