import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { builtInPoses, poseScene, referencePoses } from '../../lib/poses';
import { STAGINGS } from '../../lib/stagings';

import { MAX_DURATION, PAST_END } from '../../lib/animation';
import { actionsOf } from '../../lib/evaluate';
import { angle, anglesOf, facingOf, type Bones } from '../../lib/pose';
import { correctionTimesOf, keyTimesOf, moments } from '../../lib/track';
import type { Animation, Camera, PathCamera, Scene } from '../../lib/types';
import { CMU, bvh } from '../fixtures/bvh';
import { characterGltf } from '../fixtures/gltf';
/** The two people's poses in the Library's Poses. */
const PAIRS = STAGINGS.filter((t) => t.people === 2).length;

/** The 20 reference poses as scenes. */
const refScenes = () => referencePoses().map((p) => poseScene(p));

type Hook = {
  store: {
    getState(): {
      library: { scenes: { id: string; name: string; figures: { id: string; name: string; bones: Bones; body: { sex: number; height: number }; hands: Record<string, { curl: number[] }> }[]; props: unknown[]; cameras: { name: string }[] }[] };
      sceneIndex: number;
      activeFigure: string;
      selection: unknown;
    };
  };
  viewport: { current: { project(figure: string, joint: string): { x: number; y: number } | null; projectPoint(p: number[]): { x: number; y: number }; getView(): unknown } | null };
};

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __poseStudio: Hook }).__poseStudio.store.getState();
    return { ...s, scene: s.library.scenes[s.sceneIndex] };
  });

const project = (page: Page, joint: string) =>
  page.evaluate((j) => {
    const h = (window as unknown as { __poseStudio: Hook }).__poseStudio;
    const s = h.store.getState();
    return h.viewport.current!.project(s.activeFigure, j)!;
  }, joint);

/** Screen position of a world point. */
const projectPoint = (page: Page, p: number[]) =>
  page.evaluate((q) => (window as unknown as { __poseStudio: Hook }).__poseStudio.viewport.current!.projectPoint(q), p);

/** A part of a figure picked on the canvas: a click picks the figure, another the part (one, if the figure is picked already). */
async function pickPart(page: Page, at: { x: number; y: number }) {
  const kind = () => page.evaluate(() => ((window as unknown as { __poseStudio: Hook }).__poseStudio.store.getState().selection as { kind?: string } | null)?.kind);
  await page.mouse.click(at.x, at.y);
  await expect.poll(kind).toMatch(/^(figure|joint)$/);
  if ((await kind()) === 'figure') await page.mouse.click(at.x, at.y);
}

/** On a picked figure's move gizmo (on the floor under it): its X arrow, out from the middle. */
async function onXArrow(page: Page, floor: number[]) {
  const [a, b] = [await projectPoint(page, [floor[0], 0, floor[2]]), await projectPoint(page, [floor[0] + 0.3, 0, floor[2]])];
  return { x: a.x + (b.x - a.x) * 0.8, y: a.y + (b.y - a.y) * 0.8 };
}

/** A figure picked on the canvas: nothing selected first (Esc up to nothing), then a click on it. */
async function pickFigure(page: Page, at: { x: number; y: number }) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => ((window as unknown as { __poseStudio: Hook }).__poseStudio.store.getState().selection as { kind?: string } | null)?.kind)).toBe('figure');
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifier?: 'Shift' | 'Control') {
  await page.mouse.move(from.x, from.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

/** Width/height from a JPEG's SOF marker. */
function jpegSize(buf: Buffer) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf.readUInt16BE(i);
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('No SOF marker');
}

/** Pick an option in one of the app's drop-downs. */
async function choose(page: Page, select: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: select }).click();
  await page.getByRole('listbox', { name: select }).getByRole('option', { name: option }).click();
}

/** Unfold an inspector section (a folded one shows its title and a summary). */
async function unfold(page: Page, title: string) {
  const head = page.getByRole('complementary', { name: 'Inspector' }).locator('.psec-title').filter({ has: page.locator('h3', { hasText: new RegExp(`^${title}$`) }) });
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
}

/** From the shot inspector to its camera's (the shot shows its camera as one row). */
async function openShotCamera(page: Page) {
  await page.getByRole('complementary', { name: 'Inspector' }).locator('.summary-row').click();
}


/** Pick an item of the top bar's View menu. */
async function viewMenu(page: Page, item: string | RegExp) {
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'View' });
  await menu.getByRole('menuitemradio', { name: item }).or(menu.getByRole('menuitemcheckbox', { name: item })).or(menu.getByRole('menuitem', { name: item })).click();
}

/** Open a section of the left side panel (clicking the open one would fold it away). */
/** Open a section of the left side panel: the scene's outline or one of the library's categories (clicking the open one would fold it away). */
async function libraryShows(page: Page, what: 'Scene' | 'Characters' | 'Poses' | 'Motions' | 'Sets' | 'Lighting') {
  const tab = page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: what, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

/** The scene's outline, or the library at its Poses. */
async function openSection(page: Page, name: 'Scene' | 'Library') {
  await libraryShows(page, name === 'Scene' ? 'Scene' : 'Poses');
}

/** One of the scene outline's lists (Cast, Lights, Cameras, Shots…), the outline opened first. */
async function outline(page: Page, name: string) {
  await openSection(page, 'Scene');
  return page.getByRole('list', { name, exact: true });
}

/**
 * Add to the open scene's cast (Figure, Stand-in…) or set (props), from the Scene outline. Chosen
 * with the keyboard: put where it goes (with a click it would be placed with the pointer).
 */
/** A still scene animated: its first key, from the timeline. */
/** The seconds the timeline shows (unzoomed): the animation and the stretch past its end. */
const shownTime = (duration: number) => Math.min(MAX_DURATION, duration + PAST_END);

async function animate(page: Page) {
  await page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: 'Key the pose: animate the scene' }).click();
  await expect(page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

async function addLayer(page: Page, what: string) {
  await openSection(page, 'Scene');
  const cast = what === 'Figure' || what.startsWith('Stand-in');
  await page.getByRole('button', { name: cast ? 'Add to cast' : 'Add to set' }).click();
  await page.getByRole('menuitem', { name: what, exact: !what.startsWith('Stand-in') }).focus();
  await page.keyboard.press('Enter');
}

/** The scene picker in the top bar (opened if needed). */
async function openScenes(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Scenes' });
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  return dialog;
}

async function closeScenes(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Scenes' });
  for (let i = 0; i < 3 && (await dialog.isVisible()); i++) await page.keyboard.press('Escape');
}

async function deleteCurrentPose(page: Page) {
  await openScenes(page);
  await page.getByRole('button', { name: 'Scene actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await closeScenes(page);
}

/** A new blank scene whose figure has a motion from the library. */
async function sceneWithMotion(page: Page, motion: string, name = motion) {
  await openScenes(page);
  await page.getByRole('button', { name: 'New scene' }).click();
  await page.getByRole('menuitem', { name: 'Blank scene' }).click();
  await page.getByLabel('Scene name').fill(name);
  await openSection(page, 'Library');
  await libraryShows(page, 'Motions');
  await page.getByRole('region', { name: 'Motions' }).getByRole('button', { name: new RegExp(`^${motion} [\\d.]+ s$`) }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
}

/** The New scene dialog (Scenes → New → From a template…). */
async function newSceneDialog(page: Page) {
  await openScenes(page);
  await page.getByRole('button', { name: 'New scene' }).click();
  await page.getByRole('menuitem', { name: 'From a template…' }).click();
  return page.getByRole('dialog', { name: 'New scene' });
}

/** A new scene from a scene template, as made. */
async function templateScene(page: Page, template: string) {
  await (await newSceneDialog(page)).getByRole('button', { name: new RegExp(`^${template}`) }).first().click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
}

// The tests work in a project of the 20 reference scenes (a new project has one blank scene).
const SEEDED = JSON.stringify({ version: 3, scenes: refScenes() });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate((lib) => {
    localStorage.clear();
    localStorage.setItem('pose-studio-library', lib);
    localStorage.setItem('pose-studio-settings', JSON.stringify({}));
  }, SEEDED);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByLabel('Scene name')).toHaveValue('Hand on head');
  await page.waitForTimeout(800); // first frames + framing
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('a new project is one blank scene; the built-in poses are in the library', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByLabel('Scene name')).toHaveValue('Scene 1');
  await expect((await outline(page, 'Cast')).getByRole('button', { name: 'Figure', exact: true })).toBeVisible();
  // The canvas suggests a next step; one dismissed does not come back for the scene.
  const step = page.getByRole('status', { name: 'Next step' });
  await expect(step).toContainText('Pose Figure');
  await step.getByRole('button', { name: 'Not now' }).click();
  await expect(step).toContainText('Give Figure something to do');
  // Resting on a part says what dragging it does.
  const hand = await project(page, 'leftHand');
  // (Just below the wrist, on the hand.)
  await page.mouse.move(hand.x, hand.y + 10);
  await expect(page.locator('.bar-hint')).toContainText('left hand');
  await openSection(page, 'Library');
  const poses = page.getByRole('region', { name: 'Poses' });
  // In groups (standing, sitting, kneeling, lying, two people); resting on one shows it.
  await expect(poses.locator('li')).toHaveCount(builtInPoses().length + PAIRS);
  await poses.getByRole('button', { name: 'Cobra', exact: true }).hover();
  await expect(page.locator('.lib-preview img')).toBeVisible({ timeout: 30_000 });
  await poses.getByRole('button', { name: /Hand on head/ }).click();
  expect((await state(page)).scene.figures[0].bones.rightUpperArm).toEqual(refScenes()[0].figures[0].bones.rightUpperArm);
});

test('things have names and right-click menus; Del, Ctrl+D and F2 act on the selection', async ({ page }) => {
  // Right-click empty floor: add a prop there.
  const canvas = (await page.locator('.stage canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width * 0.85, canvas.y + canvas.height * 0.85, { button: 'right' });
  await page.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name: 'Chair', exact: true }).click();
  await openSection(page, 'Scene');

  // F2 renames in place; the inspector's title shows the name.
  await (await outline(page, 'Set')).getByRole('button', { name: 'Chair', exact: true }).click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename Chair' }).fill('Bar stool');
  await page.keyboard.press('Enter');
  await expect((await outline(page, 'Set')).getByRole('button', { name: 'Bar stool', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Chair name' })).toHaveValue('Bar stool');
  // Escape cancels a rename.
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename Bar stool' }).fill('Oops');
  await page.keyboard.press('Escape');
  await expect((await outline(page, 'Set')).getByRole('button', { name: 'Bar stool', exact: true })).toBeVisible();

  // Right-click the figure on the canvas: its menu.
  const name = (await state(page)).scene.figures[0].name;
  const chest = await project(page, 'chest');
  await page.mouse.click(chest.x, chest.y, { button: 'right' });
  await page.getByRole('menu', { name }).getByRole('menuitem', { name: 'Duplicate' }).click();
  expect((await state(page)).scene.figures).toHaveLength(2);

  // The copy is selected: F2 renames it, Del deletes it (with Undo).
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: /^Rename / }).fill('Ben');
  await page.keyboard.press('Enter');
  expect((await state(page)).scene.figures.map((f) => f.name)).toEqual([name, 'Ben']);
  await page.keyboard.press('Delete');
  await expect(page.getByText('Deleted Ben')).toBeVisible();
  expect((await state(page)).scene.figures).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
  expect((await state(page)).scene.figures).toHaveLength(2);

  // Ctrl+D duplicates the selected prop.
  await (await outline(page, 'Set')).getByRole('button', { name: 'Bar stool', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect((await outline(page, 'Set')).getByRole('button', { name: 'Bar stool 2', exact: true })).toBeVisible();

  // Right-click a scene in the picker.
  const scenes = await openScenes(page);
  await scenes.locator('button.thumb').nth(1).click({ button: 'right' });
  await page.getByRole('menu', { name: refScenes()[1].name }).getByRole('menuitem', { name: 'Duplicate' }).click();
  expect((await state(page)).library.scenes).toHaveLength(21);
  await expect(page.getByLabel('Scene name')).toHaveValue(`${refScenes()[1].name} copy`);
});

test('tooltips stay inside the window, with the shortcut apart', async ({ page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('Export');
  await expect(tip.locator('kbd')).toHaveText('Ctrl E');
  const box = (await tip.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.mouse.move(600, 400);
  await expect(tip).toHaveCount(0);
});

test('clicking a figure picks it, clicking a part of it then selects the part, and the sliders edit it', async ({ page }) => {
  const p = await project(page, 'leftLowerLeg');
  const hip = await project(page, 'leftUpperLeg');
  await pickPart(page, { x: (p.x + hip.x) / 2, y: (p.y + hip.y) / 2 });
  await expect(page.locator('.panel .panel-name')).toHaveText('Left thigh');

  const before = angle((await state(page)).scene.figures[0].bones, 'leftUpperLeg');
  const slider = page.locator('.slider input').first();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const after = angle((await state(page)).scene.figures[0].bones, 'leftUpperLeg');
  expect(after[0]).toBe(before[0] - 2);

  await page.keyboard.press('Escape');
  // Two quick steps merge into one undo step; on a slow machine they may be two.
  await page.keyboard.press('Control+z');
  if (angle((await state(page)).scene.figures[0].bones, 'leftUpperLeg')[0] !== before[0]) await page.keyboard.press('Control+z');
  expect(angle((await state(page)).scene.figures[0].bones, 'leftUpperLeg')).toEqual(before);
});

test('dragging a hand moves the arm with IK', async ({ page }) => {
  const wrist = await project(page, 'rightHand');
  const target = { x: wrist.x - 90, y: wrist.y - 110 };
  await drag(page, wrist, target);
  const now = await project(page, 'rightHand');
  expect(Math.hypot(now.x - target.x, now.y - target.y)).toBeLessThan(12);
});

test('dragging the hips down bends the knees and keeps the feet planted', async ({ page }) => {
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const ankle = await project(page, 'leftFoot');
  const root = await project(page, 'hips');
  await drag(page, root, { x: root.x, y: root.y + 70 });
  await page.waitForTimeout(200);
  const ankleAfter = await project(page, 'leftFoot');
  expect(Math.hypot(ankleAfter.x - ankle.x, ankleAfter.y - ankle.y)).toBeLessThan(6);
  expect(angle((await state(page)).scene.figures[0].bones, 'leftLowerLeg')[0]).toBeGreaterThan(30);
});

test('a picked figure moves by its gizmo, a prop by dragging it; they turn by their floor ring', async ({ page }) => {
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  type Placed = { position: number[]; rotation: number[]; bones: Bones };
  const figure = async () => (await state(page)).scene.figures[0] as unknown as Placed;
  const before = await figure();

  // Pick it (a click), then drag its gizmo's X arrow: the figure moves on the floor, its pose unchanged.
  // (Seen from ¾, the gizmo on the floor under it shows.)
  await page.keyboard.press('6');
  await page.waitForTimeout(400);
  const chest = await project(page, 'chest');
  await pickFigure(page, { x: chest.x, y: chest.y - 20 });
  const arrow = await onXArrow(page, before.position);
  await drag(page, arrow, { x: arrow.x + 100, y: arrow.y });
  let f = await figure();
  expect(f.position[0]).toBeGreaterThan(before.position[0] + 0.1);
  expect(f.bones.rightUpperArm).toEqual(before.bones.rightUpperArm);
  expect((await state(page)).selection).toMatchObject({ kind: 'figure' });

  // Drag its floor ring around a quarter turn, with Ctrl: whole 15° steps. (On the diagonals, clear
  // of the gizmo's arrows on the floor.)
  const [x, , z] = f.position;
  await drag(page, await projectPoint(page, [x - 0.21, 0, z + 0.21]), await projectPoint(page, [x + 0.21, 0, z + 0.21]), 'Control');
  f = await figure();
  expect(facingOf(f.bones) % 15).toBe(0);
  expect(facingOf(f.bones)).not.toBe(facingOf(before.bones));

  // A prop moves the same way; one undo step per drag.
  await addLayer(page, 'Box');
  // (Nothing selected: F frames everything.)
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  const prop = async () => (await state(page)).scene.props[0] as unknown as Placed;
  const p0 = await prop();
  const box = await projectPoint(page, [p0.position[0], 0.25, p0.position[2]]);
  await drag(page, box, { x: box.x - 80, y: box.y });
  expect((await prop()).position[0]).toBeLessThan(p0.position[0] - 0.1);
  await page.keyboard.press('Control+z');
  expect((await prop()).position).toEqual(p0.position);
});

test('the axes show on the view widget and in the fields; drags read out how far', async ({ page }) => {
  test.setTimeout(240_000);
  await page.keyboard.press('1');
  // The view widget's Z end is the front view.
  const front = page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'From the front' });
  await expect(front).toHaveText('Z');
  await expect(front).toHaveAttribute('aria-pressed', 'true');

  /** Drag from a point by steps, checking the readout before letting go. */
  const readout = async (from: { x: number; y: number }, dx: number, text: RegExp) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + (dx * i) / 5, from.y);
    await expect(page.locator('.drag-readout')).toHaveText(text);
    await page.mouse.up();
    await expect(page.locator('.drag-readout')).toHaveCount(0);
  };
  // A forearm swung: its slider's name and value.
  const [elbow, hand] = [await project(page, 'leftLowerArm'), await project(page, 'leftHand')];
  await readout({ x: (elbow.x + hand.x) / 2, y: (elbow.y + hand.y) / 2 }, 60, /^Left forearm · \w+ −?\d+°$/);
  // A second figure moved by its gizmo: how far, where, and how far from the other.
  await addLayer(page, 'Figure');
  await page.waitForTimeout(400);
  // (Picked: its gizmo's X arrow moves it, seen from ¾.)
  await page.keyboard.press('6');
  await page.waitForTimeout(400);
  const torso = await project(page, 'chest');
  await pickFigure(page, { x: torso.x, y: torso.y - 20 });
  const floor = ((await state(page)).scene.figures[1] as unknown as { position: number[] }).position;
  await readout(await onXArrow(page, floor), 80, /^Moved \d\.\d\d m · X −?\d\.\d\d {2}Z −?\d\.\d\d · \d\.\d\d m from Figure$/);
  // A prop's position fields carry the axes' colours.
  await addLayer(page, 'Box');
  await expect(page.locator('.numfield-prefix.axis-y').first()).toBeVisible();
});

test('a selected joint: its rows in the inspector, − and + either side stepping 5° (Shift 15°), its value typed; no card or label on the canvas', async ({ page }) => {
  await page.keyboard.press('1');
  await unfold(page, 'Joints');
  await page.getByRole('button', { name: 'Left forearm', exact: true }).click();
  await expect(page.locator('.joint-card')).toHaveCount(0);
  const bend = () => state(page).then((s) => angle(s.scene.figures[0].bones, 'leftLowerArm')[0]);
  const before = await bend();
  // (The elbow bends one way: − bends it more.)
  await page.getByRole('button', { name: 'Bend −5°' }).click();
  expect(await bend()).toBeCloseTo(before - 5, 0);
  await page.getByRole('button', { name: 'Bend −5°' }).click({ modifiers: ['Shift'] });
  expect(await bend()).toBeCloseTo(before - 20, 0);
  await page.getByRole('button', { name: 'Bend +5°' }).click();
  expect(await bend()).toBeCloseTo(before - 15, 0);
  // What − does, in its tip.
  await expect(page.getByRole('button', { name: 'Bend −5°' })).toHaveAttribute('data-tip', /^−5°, bend/);
  // Its value, typed.
  await page.getByRole('button', { name: /^Bend: .*Click to type a value$/ }).click();
  await page.getByRole('textbox', { name: 'Bend value' }).fill('-40');
  await page.getByRole('textbox', { name: 'Bend value' }).press('Enter');
  await expect.poll(bend).toBeCloseTo(-40, 0);
});

test('Shift-drag twists a part; handheld props go in the hand; the scene exports as a 3D model', async ({ page }) => {
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  type Posed = { bones: Bones; hands: Record<string, { curl: number[] }> };
  const figure = async () => (await state(page)).scene.figures[0] as unknown as Posed;
  const before = await figure();

  // Shift-drag the head sideways: it turns on its neck, the neck stays.
  const head = await project(page, 'head');
  await drag(page, { x: head.x, y: head.y - 20 }, { x: head.x + 80, y: head.y - 20 }, 'Shift');
  const after = await figure();
  expect(after.bones.head).not.toEqual(before.bones.head);
  expect(after.bones.neck).toEqual(before.bones.neck);

  // A phone goes into the selected figure's hand, which grips it.
  await (await outline(page, 'Cast')).getByRole('button').first().click();
  await addLayer(page, 'Phone');
  const prop = (await state(page)).scene.props[0] as unknown as { hold?: { hand: string } };
  expect(prop.hold?.hand).toBe('R');
  expect((await figure()).hands.R.curl[1]).toBeGreaterThan(0.4);
  await unfold(page, 'Held by');
  await expect(page.getByRole('combobox', { name: 'Held by' })).toContainText('right hand');
  // Let go (the prop's menu, in its inspector's header): it lands on the floor.
  await page.getByRole('button', { name: 'Phone menu' }).click();
  await page.getByRole('menuitem', { name: /^Let go/ }).click();
  expect(((await state(page)).scene.props[0] as unknown as { hold?: unknown; position: number[] }).hold).toBeUndefined();

  // The posed scene as a binary glTF file.
  await page.keyboard.press('Control+e');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('radio', { name: '3D model' }).click().then(() => page.getByRole('button', { name: 'Download', exact: true }).click())]);
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  expect(readFileSync((await download.path())!).subarray(0, 4).toString()).toBe('glTF');
});

test('figures, props, body and hands', async ({ page }) => {
  await addLayer(page, 'Figure');
  await addLayer(page, 'Chair');
  let s = (await state(page)).scene;
  expect(s.figures).toHaveLength(2);
  expect(s.props).toHaveLength(1);

  // The chair is selected: pick the new figure again, then its body.
  await (await outline(page, 'Cast')).getByRole('button', { name: 'Figure 2', exact: true }).click();
  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('radiogroup', { name: 'Man or woman' }).getByRole('radio', { name: 'Man', exact: true }).click();
  s = (await state(page)).scene;
  expect(s.figures[1].body.sex).toBe(0);
  expect(s.figures[0].body.sex).toBe(1);

  // Escape selects nothing: the inspector shows the scene; the figure is picked again for its hands.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Scene name' }).last()).toBeVisible();
  await (await outline(page, 'Cast')).getByRole('button', { name: 'Figure 2', exact: true }).click();
  await unfold(page, 'Hands');
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Fist' }).click();
  s = (await state(page)).scene;
  expect(s.figures[1].hands.L.curl[1]).toBe(1);

  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  s = (await state(page)).scene;
  expect(s.figures).toHaveLength(1);
  expect(s.props).toHaveLength(0);
});

test('exports all scenes as a 2400×3200 sheet', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'All scenes' }).click();
  await expect(page.getByText('2400 × 3200 px')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('Scenes.jpg');
  const size = jpegSize(readFileSync((await download.path())!));
  expect(size).toEqual({ width: 2400, height: 3200 });
});

test('share links open as a new scene', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await (await openScenes(page)).locator('.thumbs li').nth(4).locator('button').click();
  // From the scene's menu (in the scene picker).
  await openScenes(page);
  await page.getByRole('button', { name: 'Scene actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy share link' }).click();
  await expect(page.getByText('Share link copied')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#scene=');
  await page.goto(url);
  await page.reload();
  await expect(page.getByText(/Opened shared scene/)).toBeVisible();
  const s = await state(page);
  expect(s.library.scenes).toHaveLength(21);
  expect(s.scene.name).toBe('Side sit, leaning on arm');
  expect(page.url()).not.toContain('#scene=');
});

test('saves and re-imports the library as JSON', async ({ page }) => {
  await page.getByRole('button', { name: 'Main menu' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Save' }).click()]);
  const path = (await download.path())!;
  await page.getByRole('button', { name: 'Main menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Add scenes…' }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByText('Loaded 20 scenes')).toBeVisible();
  expect((await state(page)).library.scenes).toHaveLength(40);
});

test('keyboard shortcuts navigate, mirror and undo', async ({ page }) => {
  await page.keyboard.press(']');
  expect((await state(page)).sceneIndex).toBe(1);
  await page.keyboard.press('[');
  const before = (await state(page)).scene.figures[0].bones;
  await page.keyboard.press('m');
  const left = angle(before, 'leftUpperArm');
  expect(angle((await state(page)).scene.figures[0].bones, 'rightUpperArm')).toEqual([left[0], -left[1], -left[2]]);
  await page.keyboard.press('Control+z');
  expect((await state(page)).scene.figures[0].bones).toEqual(before);
});

test('poses a figure from a photo', async ({ page }) => {
  test.setTimeout(180_000);
  await openSection(page, 'Scene');
  await page.getByRole('button', { name: 'Add to cast' }).click();
  await page.getByRole('menuitem', { name: 'From a photo…' }).click();
  await page.locator('.dropzone input[type=file]').setInputFiles('tests/e2e/fixtures/mannequin-photo.png');
  await expect(page.getByText('Found 1 person.')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Apply pose' }).click();
  const s = await state(page);
  expect(s.library.scenes).toHaveLength(21);
  expect(s.scene.name).toBe('From photo');
  // Its camera looks as the photo did.
  expect(s.scene.cameras.map((c) => c.name)).toEqual(['Photo camera']);
  // The fixture is a lunge with arms pushing forward.
  expect(angle(s.scene.figures[0].bones, 'leftLowerLeg')[0]).toBeGreaterThan(20);
  // MediaPipe's usage logging is answered locally instead of reaching Google (or the CSP).
  const status = await page.evaluate(() => fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' }).then((r) => r.status));
  expect(status).toBe(204);
});

test('mobile layout uses drawers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator('.side')).not.toBeInViewport();
  await page.getByRole('button', { name: 'Side panel', exact: true }).click();
  await expect(page.locator('.side')).toBeInViewport();
  await expect(page.getByRole('list', { name: 'Cast' })).toBeVisible();
  await page.locator('.scrim').click({ position: { x: 370, y: 400 } });
  await expect(page.locator('.side')).not.toBeInViewport();
  // Scenes switch from the top bar.
  await (await openScenes(page)).locator('.thumbs li').nth(2).locator('button').click();
  expect((await state(page)).sceneIndex).toBe(2);
  // A narrow timeline keeps the transport and the key; the rest is in its menu.
  await animate(page);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();
  await expect(timeline.getByRole('button', { name: /^Cut/ })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setTime(t: number): void } } }).__poseStudio.store.setTime(1));
  await timeline.getByRole('button', { name: 'Animation options' }).click();
  await page.getByRole('menuitem', { name: /^Cut: start a new shot here/ }).click();
  await expect(page.locator('.tl-shot')).toHaveCount(2);
});

test('exports a turnaround of the current pose', async ({ page }) => {
  await page.keyboard.press('Control+e');
  // Stills film through the scene's cameras: the editor's view made into one, and picked.
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'New camera from the view' }).click();
  expect((await state(page)).scene.cameras.map((c) => c.name)).toEqual(['Camera 1', 'Camera 2']);
  await expect(page.getByRole('combobox', { name: 'Camera', exact: true })).toHaveText('Camera 2');
  await page.getByRole('radio', { name: 'Turnaround', exact: true }).click();
  await choose(page, 'Style', 'Minimal');
  await expect(page.getByText('2400 × 640 px')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('Hand_on_head_turnaround.jpg');
  expect(jpegSize(readFileSync((await download.path())!))).toEqual({ width: 2400, height: 640 });
});

test('gesture practice steps through poses', async ({ page }) => {
  await page.keyboard.press('p');
  await page.getByRole('radio', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.practice-count')).toHaveText('1 / 5');
  await expect(page.locator('.practice-timer')).toHaveText(/^[01]:\d\d$/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.practice-count')).toHaveText('2 / 5');
  await page.keyboard.press(' ');
  await expect(page.getByText('Paused')).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Session complete')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.practice')).toHaveCount(0);
  // The editor's shortcuts work again afterwards.
  await page.keyboard.press(']');
  expect((await state(page)).sceneIndex).toBe(1);
});

test('deleting a pose can be undone from the toast, which shows the pose again', async ({ page }) => {
  await deleteCurrentPose(page);
  await expect(page.getByText('Deleted “Hand on head”')).toBeVisible();
  expect((await state(page)).library.scenes).toHaveLength(19);
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  const s = await state(page);
  expect(s.library.scenes).toHaveLength(20);
  expect(s.scene.name).toBe('Hand on head');
});

test('typing an exact joint angle', async ({ page }) => {
  await unfold(page, 'Joints');
  await page.getByRole('button', { name: 'Left thigh', exact: true }).click();
  await page.getByRole('button', { name: /^Swing: .*Click to type a value$/ }).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('-42.5');
  await page.keyboard.press('Enter');
  expect(angle((await state(page)).scene.figures[0].bones, 'leftUpperLeg')[0]).toBe(-42.5);
  // Out-of-range values are clamped to the joint limits.
  await page.getByRole('button', { name: /^Swing: .*Click to type a value$/ }).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('400');
  await page.keyboard.press('Enter');
  expect(angle((await state(page)).scene.figures[0].bones, 'leftUpperLeg')[0]).toBe(50);
});

test('scene picker keyboard navigation and reordering', async ({ page }) => {
  const picker = await openScenes(page);
  const thumbs = picker.locator('.thumbs button.thumb');
  await thumbs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(thumbs.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Alt+ArrowDown');
  const s = await state(page);
  // "Hand on head" (the open scene) moved a row (three places) down and stays open.
  expect(s.library.scenes[3].name).toBe('Hand on head');
  expect(s.sceneIndex).toBe(3);
  await expect(thumbs.nth(3)).toBeFocused();
});

test('figures can be hidden without deleting them', async ({ page }) => {
  await addLayer(page, 'Figure');
  await page.getByRole('button', { name: 'Hide Figure 2' }).click();
  let s = (await state(page)).scene;
  expect(s.figures).toHaveLength(2);
  expect((s.figures[1] as { hidden?: boolean }).hidden).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.viewport.current!.project(
    (window as unknown as { __poseStudio: Hook }).__poseStudio.store.getState().library.scenes[0].figures[1].id, 'hips',
  ))).toBeNull();
  await page.getByRole('button', { name: 'Show Figure 2' }).click();
  s = (await state(page)).scene;
  expect((s.figures[1] as { hidden?: boolean }).hidden).toBeUndefined();
});

test('changes made in another tab are picked up', async ({ page, context }) => {
  // Two pages rendering 3D in software (CI has no GPU) share the CPU: the second one loads slowly.
  test.setTimeout(240_000);
  const other = await context.newPage();
  await other.goto('/');
  await other.locator('.stage canvas').waitFor({ timeout: 180_000 });
  await deleteCurrentPose(other);
  await expect(other.locator('.save-status')).toHaveText('Saved');
  await expect(page.getByText('Your scenes were updated in another tab')).toBeVisible();
  expect((await state(page)).library.scenes).toHaveLength(19);
  await other.close();
});

test('render styles switch from the toolbar: the project\'s look', async ({ page }) => {
  const style = async () => (await state(page) as unknown as { library: { settings?: { style: string } } }).library.settings?.style;
  await page.getByRole('button', { name: 'Render style' }).click();
  await page.getByRole('menuitemradio', { name: 'Ink wash' }).click();
  expect(await style()).toBe('ink');
  await page.getByRole('button', { name: 'Render style' }).click();
  await page.getByRole('menuitemradio', { name: 'Anime' }).click();
  expect(await style()).toBe('anime');
  await expect(page.getByRole('button', { name: 'Render style' })).toContainText('Anime');
  // L cycles through every style.
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('l');
  expect(await style()).toBe('pixel');
  await expect(page.getByRole('button', { name: 'Render style' })).toContainText('Pixel');
  await page.keyboard.press('l');
  expect(await style()).toBe('render');
  await expect(page.getByRole('button', { name: 'Render style' })).toContainText('3D');
  await page.keyboard.press('l');
  expect(await style()).toBe('shaded');
});

test('a body is a man or a woman and a height', async ({ page }) => {
  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('radiogroup', { name: 'Man or woman' }).getByRole('radio', { name: 'Man', exact: true }).click();
  expect((await state(page)).scene.figures[0].body.sex).toBe(0);
  await page.getByRole('slider', { name: 'Height' }).fill('1.25');
  expect((await state(page)).scene.figures[0].body).toEqual({ sex: 0, height: 1.25 });
  await page.getByRole('radiogroup', { name: 'Man or woman' }).getByRole('radio', { name: 'Woman' }).click();
  expect((await state(page)).scene.figures[0].body).toEqual({ sex: 1, height: 1.25 });
});

type Fig = { id: string; position: number[]; bones: Bones };
const figs = async (page: Page) => (await state(page)).scene.figures as unknown as Fig[];

test('multi-person set-ups and relation tools', async ({ page }) => {
  // The New menu leads to the templates.
  await (await newSceneDialog(page)).getByRole('region', { name: 'Standing together' }).getByRole('button', { name: /^Handshake/ }).click();
  expect((await state(page)).scene.name).toBe('Handshake');
  await openSection(page, 'Scene');
  let [a, b] = await figs(page);
  expect(Math.abs(facingOf(a.bones) - facingOf(b.bones))).toBeCloseTo(180, 0);

  await unfold(page, 'With others');
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Back to back' }).click();
  [a, b] = await figs(page);
  expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeCloseTo(0.32, 2);
  expect(Math.abs(Math.abs(facingOf(a.bones) - facingOf(b.bones)) - 180)).toBeLessThan(0.5);

  await page.getByRole('button', { name: 'Face each other' }).click();
  await page.getByRole('slider', { name: 'Distance' }).fill('1.5');
  [a, b] = await figs(page);
  expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeCloseTo(1.5, 1);

  // Too far apart to touch: the app says so.
  await choose(page, 'Touch', /Left shoulder$/);
  await page.getByRole('button', { name: 'Reach' }).click();
  await expect(page.getByText('Out of reach')).toBeVisible();
  await page.getByRole('slider', { name: 'Distance' }).fill('0.6');
  const before = (await figs(page))[0].bones.rightUpperArm;
  await page.getByRole('button', { name: 'Reach' }).click();
  expect((await figs(page))[0].bones.rightUpperArm).not.toEqual(before);

  await page.getByRole('button', { name: 'Look at' }).click();
  expect(anglesOf((await figs(page))[0].bones).head).toBeTruthy();

  // Saved as a template of my own (the scene's menu), it goes into another scene around the figure selected there.
  await openScenes(page);
  page.once('dialog', (d) => d.accept('Close talk'));
  await page.getByRole('button', { name: 'Scene actions' }).click();
  await page.getByRole('menuitem', { name: 'Save as template…' }).click();
  await closeScenes(page);
  let dialog = await newSceneDialog(page);
  await expect(dialog.getByRole('region', { name: 'My templates' }).getByRole('button', { name: /^Close talk/ })).toBeVisible();
  await dialog.getByRole('button', { name: /^Group photo/ }).click();
  expect((await state(page)).scene.name).toBe('Group photo');
  const people = (await state(page)).scene.figures.length;
  await openSection(page, 'Scene');
  await (await outline(page, 'Cast')).getByRole('button').first().click();
  dialog = await newSceneDialog(page);
  await dialog.getByRole('button', { name: /^Put Close talk into this scene/ }).click();
  // Its first role on the figure selected, the second on the one nearest it: nobody new.
  await expect.poll(async () => (await state(page)).scene.figures.length).toBe(people);

  // A shoot preset: a template opened and filmed with a coverage in one go.
  await (await newSceneDialog(page)).getByRole('region', { name: 'Ready to shoot' }).getByRole('button', { name: /^Interview/ }).click();
  const shoot = (await live(page)).scene;
  expect(shoot.name).toBe('Interview');
  expect(shoot.cameras.filter((c) => c.made?.startsWith('dialogue:'))).toHaveLength(5);
});

test('placement fields move and turn the figure', async ({ page }) => {
  const x = page.getByRole('textbox', { name: 'Position X' });
  await x.fill('0.5');
  await x.press('Enter');
  const facingField = page.getByRole('textbox', { name: 'Facing' });
  await facingField.fill('90');
  await facingField.press('Enter');
  const [f] = await figs(page);
  expect(f.position[0]).toBe(0.5);
  expect(facingOf(f.bones)).toBe(90);
});

type Anim = Animation;
const anim = async (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __poseStudio: { store: { getState(): { time: number; sceneIndex: number; library: { scenes: { animation?: unknown; cameras: unknown }[] } } } } }).__poseStudio.store.getState();
  const scene = s.library.scenes[s.sceneIndex];
  return { time: s.time, animation: scene.animation as Anim | undefined, cameras: scene.cameras as Camera[] };
});

test('a library motion plays, takes keys and is filmed by a shot camera', async ({ page }) => {
  await sceneWithMotion(page, 'Dance groove');
  // On the figure's track: it holds its pose, then dances (a clip from the library).
  let s = await live(page);
  expect(actionsOf(s.scene.animation!, s.active).map((x) => x.source.kind)).toEqual(['keys', 'clip']);

  const editorView = () => page.evaluate(() => JSON.stringify((window as unknown as { __poseStudio: Hook }).__poseStudio.viewport.current!.getView()));
  const free = await editorView();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Playing: the film as filmed (the shot camera), the playhead moving on (however busy the machine).
  await expect(page.locator('.letterbox')).toBeVisible();
  await expect(page.locator('.tl-time')).not.toHaveText(/^0\.00/);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect((await anim(page)).time).toBeGreaterThan(0);
  // Stopped: the free view as it was.
  await expect(page.locator('.letterbox')).toBeHidden();
  await expect.poll(editorView).toBe(free);

  // Step to a frame between keys and add a key there.
  await page.getByRole('button', { name: 'Previous key' }).click();
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await page.keyboard.press('k');
  // Keyed over the dance: a correction to it.
  s = await live(page);
  expect(actionsOf(s.scene.animation!, s.active, 'correction')).toHaveLength(1);

  await viewMenu(page, 'Shot camera');
  await expect(page.locator('.letterbox')).toBeVisible();
  // The shot's camera move: from its inspector to the library's camera moves.
  await openSection(page, 'Scene');
  await (await outline(page, 'Shots')).getByRole('button', { name: /Shot 1 / }).click();
  // (Its camera's inspector, a ready-made move there.)
  await page.getByRole('button', { name: 'Choose a camera move…' }).click();
  await page.getByRole('button', { name: 'Ready-made moves' }).click();
  await page.getByRole('menuitem', { name: 'Orbit 360°' }).click();
  const filmed = await anim(page);
  // (A framing with its move, kept as one: a 360° arc, not points.)
  expect(filmed.cameras.find((c) => c.id === filmed.animation!.shots[0].camera)).toMatchObject({ kind: 'rig', rig: { move: { kind: 'arc', by: 360 } } });

  // Exported as an animated glTF: the figure's animation (its joints and hips) and the shot camera's.
  await page.keyboard.press('Control+e');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('radio', { name: '3D model' }).click().then(() => page.getByRole('button', { name: 'Download', exact: true }).click())]);
  const glb = readFileSync((await download.path())!);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { animations: { name: string; channels: unknown[] }[]; cameras?: unknown[] };
  expect(json.animations.map((x) => x.name)).toEqual([s.scene.figures[0].name, 'Camera']);
  expect(json.animations[0].channels.length).toBeGreaterThan(17);
  expect(json.cameras).toHaveLength(1);
});

test('a shot is framed by size and lens, and its camera path edited on the canvas', async ({ page }) => {
  await openSection(page, 'Scene');
  await animate(page);
  await page.locator('.tl-shot').first().click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  // The camera the shot films with, moving along a path.
  const shot = async () => {
    const { animation, cameras } = await anim(page);
    return cameras.find((c) => c.id === animation!.shots[0].camera) as PathCamera;
  };
  await openShotCamera(page);
  await unfold(page, 'Moves');
  await inspector.getByRole('radiogroup', { name: 'Camera', exact: true }).getByRole('radio', { name: 'Path' }).click();
  // A medium shot at the playhead, then an 85 mm lens (the subject keeps its size: the camera backs off).
  await choose(page, 'Shot size', /^MS ·/);
  let s = await shot();
  expect(s.points[0].t).toBe(0);
  const near = Math.hypot(...s.points[0].position.map((v, i) => v - s.points[0].look[i]));
  const lens = s.points[0].lens;
  await choose(page, 'Lens', '85 mm');
  s = await shot();
  expect(s.points[0].lens).toBe(85);
  expect(Math.hypot(...s.points[0].position.map((v, i) => v - s.points[0].look[i]))).toBeCloseTo((near * 85) / lens, 1);
  await expect(inspector.getByRole('combobox', { name: 'Shot size' })).toHaveText(/^MS ·/);
  // Looking through it with framing guides: the frame's thirds and safe areas.
  await viewMenu(page, 'Shot camera');
  await viewMenu(page, /Guides/);
  await expect(page.locator('.letterbox .third')).toHaveCount(4);
  await viewMenu(page, 'Free view');
  // A close-up through a wide lens (the camera near the figure); seen from above and aside, the
  // shot's camera is dragged across the floor, its height kept.
  await choose(page, 'Shot size', /^CU ·/);
  await choose(page, 'Lens', '24 mm');
  s = await shot();
  await page.keyboard.press('Escape');
  await page.keyboard.press('6');
  await page.waitForTimeout(600);
  const before = s.points[0].position;
  const at = await projectPoint(page, before);
  await drag(page, at, { x: at.x + 60, y: at.y });
  s = await shot();
  const after = s.points[0].position;
  expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(0.1);
  expect(after[1]).toBeCloseTo(before[1], 2);
  // The camera is an object of the scene: listed in the outline, with an inspector of its own.
  await (await outline(page, 'Cameras')).getByRole('button', { name: /^Camera 1/ }).click();
  await expect(inspector.getByRole('textbox', { name: 'Camera name' })).toHaveValue('Camera 1');
  await unfold(page, 'Shots');
  await expect(inspector.getByRole('list', { name: 'Shots it films' })).toContainText('Shot 1');
  // Following its subject again (#21; no move: it holds its framing): the shot size is a rule, kept every frame.
  await unfold(page, 'Moves');
  await inspector.getByRole('radiogroup', { name: 'Camera', exact: true }).getByRole('radio', { name: 'Follows' }).click();
  await choose(page, 'Shot size', /^MCU ·/);
  expect(await shot()).toMatchObject({ kind: 'rig', rig: { size: 'mcu' } });
  // An arc round it over the shot, by 90° to start with.
  await inspector.getByRole('radiogroup', { name: 'Camera move' }).getByRole('radio', { name: 'Arc' }).click();
  expect(await shot()).toMatchObject({ kind: 'rig', rig: { move: { kind: 'arc', by: 90 } } });
  // Fixed (#21): it stands where it is, its moves a tripod's (an arc is not one: dropped); locked, or turning to its subject.
  await inspector.getByRole('radiogroup', { name: 'Camera', exact: true }).getByRole('radio', { name: 'Fixed' }).click();
  const fixed = (await shot()) as unknown as { kind: string; rig: { move?: unknown; fixed?: { aim?: string } } };
  expect(fixed.kind).toBe('rig');
  expect(fixed.rig.fixed).toBeTruthy();
  expect(fixed.rig.move).toBeUndefined();
  await expect(inspector.getByRole('radiogroup', { name: 'Camera move' }).getByRole('radio')).toHaveText(['None', 'Pan', 'Tilt', 'Zoom', 'Roll']);
  await inspector.getByRole('radiogroup', { name: 'Fixed camera aims' }).getByRole('radio', { name: 'Subject' }).click();
  expect(((await shot()) as unknown as typeof fixed).rig.fixed!.aim).toBe('subject');
});

test('cuts move on the timeline; a camera on a path has a row, one on a rule none; looked through', async ({ page }) => {
  await openSection(page, 'Scene');
  await animate(page);
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setTime(t: number): void } } }).__poseStudio.store.setTime(1));
  await page.keyboard.press('c');
  // The cut is dragged later; the cameras stay as they were.
  const before = await anim(page);
  const cut = page.locator('.tl-shot').nth(1).locator('.tl-cut');
  const box = (await cut.boundingBox())!;
  await drag(page, { x: box.x + 2, y: box.y + box.height / 2 }, { x: box.x + 62, y: box.y + box.height / 2 });
  const after = await anim(page);
  expect(after.animation!.shots[1].start).toBeGreaterThan(1.05);
  expect(after.cameras).toEqual(before.cameras);
  // Its ramp, dragged out, blends the shot in.
  const ramp = (await page.locator('.tl-shot').nth(1).locator('.tl-blend').boundingBox())!;
  await page.locator('.tl-shot').nth(1).hover();
  await drag(page, { x: ramp.x + 8, y: ramp.y + 4 }, { x: ramp.x + 60, y: ramp.y + 4 });
  expect((await anim(page)).animation!.shots[1].blend).toBeGreaterThan(0.1);
  // The second shot films with a new camera (its menu), fixed where the view was (#21).
  await page.locator('.tl-shot').nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New camera from the view' }).click();
  const made2 = await anim(page);
  const second = made2.cameras.find((c) => c.id === made2.animation!.shots[1].camera)!;
  expect(second.name).toBe('Camera 2');
  expect((second as Camera & { rig: { fixed?: unknown } }).rig.fixed).toBeTruthy();
  // Selected in the outline, the first camera: it places itself by its rule, nothing to edit on the timeline (no row).
  await (await outline(page, 'Cameras')).getByRole('button', { name: /^Camera 1/ }).click();
  await expect(page.locator('.tl-row.camera')).toHaveCount(0);
  // Selected, it shows its picture in the canvas's corner.
  await expect(page.getByRole('button', { name: 'Look through Camera 1' })).toBeVisible();
  // Looked through from its menu: a banner says the view moves it; Ctrl+D copies it.
  await (await outline(page, 'Cameras')).getByRole('button', { name: /^Camera 1/ }).click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Look through it' }).click();
  await expect(page.locator('.letterbox-banner')).toHaveText(/^Moving Camera 1 at \d+\.\d\d s: drag to change it · Esc to stop$/);
  await page.keyboard.press('Control+d');
  expect((await anim(page)).cameras.map((c) => c.name)).toEqual(['Camera 1', 'Camera 2', 'Camera 1 copy']);
  // Its shot sizes are chips in the picture.
  await page.getByRole('group', { name: 'Shot size' }).getByRole('button', { name: 'MCU' }).click();
  expect(((await anim(page)).cameras[0] as Camera & { rig: { size: string } }).rig.size).toBe('mcu');
  // C cuts here, the new shot filmed from this view by a new camera (looked through); Esc stops looking through.
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setTime(t: number): void } } }).__poseStudio.store.setTime(0.5));
  await page.keyboard.press('c');
  const made = await anim(page);
  expect(made.cameras).toHaveLength(4);
  expect(made.animation!.shots.find((x) => Math.abs(x.start - 0.5) < 0.05)!.camera).toBe(made.cameras[3].id);
  await expect(page.locator('.letterbox-banner')).toContainText(made.cameras[3].name);
  await page.keyboard.press('Escape');
  await expect(page.locator('.letterbox')).toHaveCount(0);
});

test('a still scene can be animated with auto-keys', async ({ page }) => {
  await animate(page);
  for (let i = 0; i < 12; i++) await page.keyboard.press('.');
  expect((await anim(page)).time).toBeCloseTo(0.5, 2);
  await unfold(page, 'Joints');
  await page.getByRole('button', { name: 'Left thigh', exact: true }).click();
  const slider = page.locator('.slider input').first();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  const s = await live(page);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 0.5]);
  // Auto-key says so: the posed figure's row is marked.
  await expect(page.locator('.tl-row.autokey')).toHaveCount(1);
});

test('the timeline grows: the playhead goes past the end and a key there lengthens it; a row\'s + at its end; shortening asks to scale or cut', async ({ page }) => {
  await animate(page);
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure/ }).first().click();
  let s = await live(page);
  const d = s.scene.animation!.duration;
  // A click in the faint stretch past the end puts the playhead there; a key there lengthens the animation.
  await expect(page.locator('.tl-past')).toBeVisible();
  const ruler = (await page.locator('.tl-ruler').boundingBox())!;
  await page.mouse.click(ruler.x + ruler.width - 2, ruler.y + ruler.height / 2);
  s = await live(page);
  expect(s.time).toBeGreaterThan(d + 1.5);
  await page.keyboard.press('k');
  s = await live(page);
  const longer = s.scene.animation!.duration;
  expect(longer).toBeCloseTo(s.time, 2);
  expect(keyTimesOf(s.scene.animation!, s.active).at(-1)).toBeCloseTo(longer, 2);

  // The + at the end of the row: what the figure does after all it does (the playhead goes there).
  await page.mouse.click(ruler.x + 4, ruler.y + ruler.height / 2);
  await page.getByRole('button', { name: /^What Figure does after all it does/ }).click();
  await expect(page.getByRole('dialog', { name: 'What Figure does next' })).toBeVisible();
  expect((await live(page)).time).toBeCloseTo(longer, 2);
  await page.keyboard.press('Escape');

  // Shorter: it asks first; Cut instead keeps the timing and drops what is past the new end.
  const field = page.getByRole('textbox', { name: 'Duration' });
  await field.fill('1');
  await field.press('Enter');
  // (Nothing changes until it is answered.)
  expect((await live(page)).scene.animation!.duration).toBeCloseTo(longer, 2);
  await page.getByRole('alertdialog', { name: 'Shorten the animation' }).getByRole('button', { name: 'Cut instead' }).click();
  s = await live(page);
  expect(s.scene.animation!.duration).toBe(1);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 1]);
});

test('keyframes pose to pose: a key held until the next, a pose held for a time, a keyed block repeated and kept as a motion', async ({ page }) => {
  await animate(page);
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure/ }).first().click();
  for (let i = 0; i < 24; i++) await page.keyboard.press('.');
  await page.keyboard.press('k');
  let s = await live(page);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 1]);
  const keysClip = (x: typeof s) => actionsOf(x.scene.animation!, x.active).find((a) => a.source.kind === 'keys')!;

  // The first key held until the next: a square on the timeline.
  // (Its right half: the key at 0 sits half outside the lanes.)
  await page.getByRole('button', { name: 'Key at 0.00 s' }).click({ button: 'right', position: { x: 11, y: 7 } });
  await page.getByRole('menuitemradio', { name: /held until the next/ }).click();
  s = await live(page);
  expect((keysClip(s).source as { clip: { parts: { eases?: string[] }[] } }).clip.parts[0].eases?.[0]).toBe('step');
  await expect(page.getByRole('button', { name: 'Key at 0.00 s' })).toHaveClass(/\bstep\b/);

  // Hold the second pose for a second: a copy of it a second on.
  await page.getByRole('button', { name: 'Key at 1.00 s' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^1 s/ }).click();
  s = await live(page);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 1, 2]);

  // The block played twice in all, then kept in My motions.
  await page.locator('.tl-travel.keys').first().click({ button: 'right', position: { x: 30, y: 8 } });
  await page.getByRole('menuitem', { name: /^2 times in all/ }).click();
  s = await live(page);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 1, 2, 3, 4]);
  await page.locator('.tl-travel.keys').first().click({ button: 'right', position: { x: 30, y: 8 } });
  await page.getByRole('menuitem', { name: 'Save as a motion' }).click();
  await expect(page.getByText(/Saved as “Figure's motion” in My motions/)).toBeVisible();
  expect(s.motions.length + 1).toBe((await live(page)).motions.length);
});

test('keys picked together with Shift-click move together; a correction is a band of its own', async ({ page }) => {
  await animate(page);
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure/ }).first().click();
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 24; i++) await page.keyboard.press('.');
    await page.keyboard.press('k');
  }
  let s = await live(page);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 1, 2]);
  await page.getByRole('button', { name: 'Key at 1.00 s' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Key at 2.00 s' }).click({ modifiers: ['Shift'] });
  await expect(page.locator('.tl-key.picked')).toHaveCount(2);
  // Dragged by one of them, half a second on: both go.
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const key = (await page.getByRole('button', { name: 'Key at 1.00 s' }).boundingBox())!;
  const dx = (lanes.width * 0.5) / shownTime(s.scene.animation!.duration);
  await page.mouse.move(key.x + key.width / 2, key.y + key.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(key.x + key.width / 2 + (dx * i) / 5, key.y + key.height / 2);
  await page.mouse.up();
  s = await live(page);
  expect(keyTimesOf(s.scene.animation!, s.active)).toEqual([0, 1.5, 2.5]);
});

test('exports an animation as a frame sheet and as a video', async ({ page }) => {
  // Software rendering and encoding on CI machines without a GPU is slow.
  test.setTimeout(300_000);
  await sceneWithMotion(page, 'Wave hello');
  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Frame sheet' }).click();
  await expect(page.getByText('2400 × 1280 px')).toBeVisible();
  let [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('Wave_hello_frames.jpg');
  expect(jpegSize(readFileSync((await download.path())!))).toEqual({ width: 2400, height: 1280 });

  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await expect(page.getByText(/1280 × 720 px · 1\.2 s at 24 fps/)).toBeVisible();
  await page.keyboard.press('Escape');
  // Filmed square (the frame, in the top bar): the video follows.
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '1:1 square' }).click();
  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await expect(page.getByText(/720 × 720 px/)).toBeVisible();
  [download] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Wave_hello\.(webm|mp4)$/);
  expect(readFileSync((await download.path())!).length).toBeGreaterThan(2000);
});

test('cuts shots and exports a keyframe pack with depth and normal passes', async ({ page }) => {
  test.setTimeout(240_000);
  await sceneWithMotion(page, 'Wave hello');
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setTime(t: number): void } } }).__poseStudio.store.setTime(0.5));
  await page.getByRole('button', { name: /^Cut: start a new shot here/ }).click();
  await expect(page.locator('.tl-shot')).toHaveCount(2);
  // Shots are listed in the Scene outline and edited in the inspector.
  await openSection(page, 'Scene');
  await (await outline(page, 'Shots')).getByRole('button', { name: /Shot 2 / }).click();
  await page.getByRole('textbox', { name: 'Shot caption' }).fill('She waves back');
  // Shortcuts are off while typing.
  await page.getByRole('textbox', { name: 'Shot caption' }).blur();

  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'AI video pack', exact: true }).click();
  await page.getByRole('switch', { name: 'Greybox clips' }).uncheck();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 200_000 }), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('Wave_hello_ai_pack.zip');
  const zip = readFileSync((await download.path())!);
  const text = zip.toString('latin1');
  for (const name of ['cutlist.otio', '01_Shot_1/first_depth.png', '02_Shot_2/last_normal.png', '02_Shot_2/camera.json']) expect(text).toContain(name);
  expect(text).toContain('she waves back');
});

test('storyboard: the scene list in its order, shot by shot, captions, reordering, exported from the Export dialog, kept', async ({ page }) => {
  test.setTimeout(150_000);
  const first = (await state(page)).scene.name;
  await page.keyboard.press('b');
  const board = page.getByRole('dialog', { name: 'Storyboard' });
  // Every scene, in the scene list's order: the 20 reference poses, still.
  await expect(board.locator('.panel-card')).toHaveCount(20);
  // One left out of the story, then put back from the board's list.
  await board.getByRole('button', { name: `Leave ${first} out of the story` }).click();
  await expect(board.locator('.panel-card')).toHaveCount(19);
  await board.getByRole('button', { name: 'Add a scene' }).first().click();
  await board.getByRole('list', { name: 'Scenes to add' }).getByRole('button', { name: first, exact: true }).click();
  await expect(board.locator('.panel-card')).toHaveCount(20);
  await board.getByRole('button', { name: 'Close storyboard' }).click();

  // The fourth scene, animated and cut into two shots.
  await (await openScenes(page)).locator('.thumbs li').nth(3).click();
  const second = (await state(page)).scene.name;
  await closeScenes(page);
  await openSection(page, 'Scene');
  await animate(page);
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setTime(t: number): void } } }).__poseStudio.store.setTime(1));
  await page.keyboard.press('c');
  await page.keyboard.press('b');
  // A panel per shot: the still scenes, and the animated one's two shots in its place.
  await expect(board.locator('.panel-card')).toHaveCount(21);
  await expect(board.getByText('20 scenes · 21 shots · 40.0 s')).toBeVisible();
  await expect(board.locator('.panel-name').nth(4)).toHaveText(`${second} · Shot 2`);
  // A shot's caption is the shot's own.
  await board.getByRole('textbox', { name: 'Panel 5 caption' }).fill('A sudden turn');
  expect((await state(page) as unknown as { scene: { animation: { shots: { caption?: string }[] } } }).scene.animation.shots[1].caption).toBe('A sudden turn');

  // Moving a scene moves all of its shots, and the scene in the list.
  await board.locator('.panel-card').nth(3).dragTo(board.locator('.panel-card').nth(0));
  await expect(board.locator('.panel-name').first()).toHaveText(`${second} · Shot 1`);
  await expect(board.getByRole('textbox', { name: 'Panel 2 caption' })).toHaveValue('A sudden turn');
  expect((await state(page)).library.scenes[0].name).toBe(second);

  // Exported from the Export dialog, the story chosen.
  await board.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Storyboard image' })).toHaveAttribute('aria-checked', 'true');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Storyboard\.(jpg|png)$/);
  expect(readFileSync((await download.path())!).length).toBeGreaterThan(5000);

  await page.waitForFunction(() => (window as unknown as { __poseStudio: { store: { getState(): { saveStatus: string } } } }).__poseStudio.store.getState().saveStatus === 'saved');
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await page.keyboard.press('b');
  await expect(board.getByRole('textbox', { name: 'Panel 2 caption' })).toHaveValue('A sudden turn');
});

test('motion check flags foot sliding and jumps to it', async ({ page }) => {
  test.setTimeout(120_000);
  await sceneWithMotion(page, 'Walk ahead');
  await page.locator('.tl-qa').click();
  await expect(page.locator('.tl-qa')).toHaveText('No issues', { timeout: 30_000 });

  // Gliding the same 3 m instead of walking: the feet slide.
  const keys = await live(page).then((x) => moments(x.scene.animation!, x.active));
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const row = (await page.locator('[aria-label="Pose keys"]').boundingBox())!;
  const duration = (await anim(page)).animation!.duration;
  await page.mouse.click(lanes.x + (lanes.width * (keys[0] + keys[1])) / 2 / shownTime(duration), row.y + row.height / 2, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Glide (as keyed)' }).click();
  await page.locator('.tl-qa').click();
  const card = page.getByRole('dialog', { name: 'Motion check' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tl-issue').first()).toBeVisible();
  await card.locator('li button').filter({ hasText: /foot slides/ }).first().click();
  const s = await state(page);
  expect((s as unknown as { time: number }).time).toBeGreaterThan(0);
  expect(s.selection).toMatchObject({ kind: 'joint', joint: expect.stringMatching(/^(left|right)Foot$/) });
  // Editing the animation clears the results.
  await page.keyboard.press('k');
  await expect(page.locator('.tl-issue')).toHaveCount(0);
});

test('stand-ins block a scene in a posture and can become posable figures', async ({ page }) => {
  await addLayer(page, 'Stand-in');
  await expect((await outline(page, 'Cast')).getByRole('button', { name: 'Stand-in', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Sit' }).click();
  let s = await state(page);
  const standIn = () => s.scene.figures.find((f) => f.id === s.activeFigure) as unknown as { proxy?: string; bones: Bones };
  expect(standIn().proxy).toBe('sit');
  expect(angle(standIn().bones, 'leftLowerLeg')[0]).toBeGreaterThan(80);
  // Not posed joint by joint: no IK handles, no joint panel.
  await expect(page.getByRole('button', { name: /^Joints/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Make it a posable figure' }).click();
  s = await state(page);
  expect(standIn().proxy).toBeUndefined();
  await expect(page.getByRole('button', { name: /^Joints/ })).toBeVisible();
});

async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('menuitem', { name: /Test account/ }).click();
  await expect(page.locator('.avatar')).toBeVisible({ timeout: 30_000 });
}

test('signing in syncs the library to the account (server edition)', async ({ page }) => {
  test.setTimeout(150_000);
  await page.getByRole('tab', { name: 'AI assistant' }).click();
  await expect(page.getByText('Sign in to pose and animate by describing it')).toBeVisible();
  // An imported motion's frames go up apart from the library, as a file of its own.
  await openSection(page, 'Library');
  await libraryShows(page, 'Motions');
  await page.getByLabel('Motion file').setInputFiles({ name: 'Step forward.bvh', mimeType: 'text/plain', buffer: Buffer.from(bvh(CMU)) });
  await expect(page.getByRole('list', { name: 'My motions' })).toBeVisible();
  const motion = (await live(page)).motions[0].id;
  await signIn(page);
  // (Signing in may still be navigating: a call the navigation cut short is tried again.)
  const server = () => page.evaluate(() => fetch('/api/library').then((r) => r.json()) as Promise<{ version: number; library: { scenes: { name: string }[] } | null }>)
    .catch(() => ({ version: 0, library: null }));
  await expect.poll(async () => (await server()).library?.scenes.length ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(20);
  await expect.poll(() => page.evaluate(() => fetch('/api/assets').then((r) => r.json()).then((x: { ids: string[] }) => x.ids)).catch(() => [] as string[]), { timeout: 30_000 }).toContain(motion);
  // Edits follow a moment later.
  await page.getByLabel('Scene name').fill('Synced scene');
  await expect.poll(async () => (await server()).library?.scenes.map((s) => s.name), { timeout: 30_000 }).toContain('Synced scene');
  // One indicator: saved here, then synced to the account.
  await expect(page.locator('.save-status')).toHaveText(/Synced/);
});

test('the AI assistant runs on the server and its tools on the open pose', async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page);
  await page.getByRole('tab', { name: 'AI assistant' }).click();
  await page.getByLabel('Message the assistant').fill('Anime style please');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Switched to anime/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.assistant-tool code')).toHaveText('set_style');
  expect(await page.evaluate(() => (window as unknown as { __poseStudio: { store: { getState(): { library: { settings?: { style: string } } } } } }).__poseStudio.store.getState().library.settings?.style)).toBe('anime');
  await expect(page.locator('.assistant-usage')).toContainText('/ 1000');
});

test('each figure has its own key track', async ({ page }) => {
  await addLayer(page, 'Figure');
  const [first, second] = (await live(page)).scene.figures;
  await animate(page);
  // Each keyed at 1 s: the second, then the first.
  await (await outline(page, 'Cast')).getByRole('button', { name: new RegExp(`^${second.name}\\b`) }).first().click();
  for (let i = 0; i < 24; i++) await page.keyboard.press('.');
  await page.keyboard.press('k');
  await (await outline(page, 'Cast')).getByRole('button', { name: new RegExp(`^${first.name}\\b`) }).first().click();
  await page.keyboard.press('k');
  const key = (f: { name: string }) => page.getByRole('button', { name: new RegExp(`^${f.name} key at 1.00 s`) });
  await expect(key(first)).toBeVisible();
  await expect(key(second)).toBeVisible();
  // Delete the first's key at 1 s: the second's stays.
  await key(first).click();
  await page.getByRole('button', { name: `Delete key (${first.name})` }).click();
  await expect(key(first)).toHaveCount(0);
  await expect(key(second)).toBeVisible();
});

test('the inspector folds away for more canvas and remembers it', async ({ page }) => {
  const before = (await page.locator('.stage').boundingBox())!.width;
  await page.getByRole('button', { name: 'Hide the inspector' }).first().click();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
  expect((await page.locator('.stage').boundingBox())!.width).toBeGreaterThan(before + 200);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('i');
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
});

test('the side panel switches sections (the scene, a library category each), folds away and remembers it', async ({ page }) => {
  await libraryShows(page, 'Sets');
  await expect(page.getByRole('tabpanel').getByRole('searchbox', { name: 'Search sets' })).toBeVisible();
  await libraryShows(page, 'Scene');
  await animate(page);
  await expect(page.getByRole('list', { name: 'Shots' })).toBeVisible();
  // Clicking the open section folds the panel; the canvas gets the room.
  const before = (await page.locator('.stage').boundingBox())!.width;
  await page.getByRole('tab', { name: 'Scene', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  expect((await page.locator('.stage').boundingBox())!.width).toBeGreaterThan(before + 200);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await libraryShows(page, 'Scene');
  await expect(page.getByRole('list', { name: 'Cast' })).toBeVisible();
});

test('library assets apply to the selection: poses to a figure, motions to its track, saved poses', async ({ page }) => {
  await addLayer(page, 'Figure');
  const [, second] = await figs(page);
  await openSection(page, 'Library');
  await page.getByRole('region', { name: 'Poses' }).getByRole('button', { name: /Cobra/ }).click();
  const [a, b] = await figs(page);
  // The selected (new) figure took the pose where it stands; the first one did not change.
  expect(b.id).toBe(second.id);
  const [hx, , hz] = angle(refScenes()[10].figures[0].bones, 'hips');
  angle(b.bones, 'hips').forEach((v, i) => expect(v).toBeCloseTo([hx, 0, hz][i], 0));
  expect(a.bones).toEqual(refScenes()[0].figures[0].bones);
  // Save it, then a motion goes on this figure's track only.
  await page.getByRole('button', { name: /Save Figure 2's pose/ }).click();
  await expect(page.getByRole('region', { name: 'Poses' }).locator('li')).toHaveCount(builtInPoses().length + PAIRS + 1);
  await libraryShows(page, 'Motions');
  await page.getByRole('region', { name: 'Motions' }).getByRole('button', { name: /^Jump ahead/ }).click();
  const sc = (await live(page)).scene;
  const tracks = sc.figures.map((f) => actionsOf(sc.animation!, f.id).map((x) => (x.source.kind === 'travel' ? x.source.mode : x.source.kind)));
  expect(tracks[0]).toEqual(['keys']);
  // Holding where it stands, then a jump to where it lands (its steps generated).
  expect(tracks[1]).toEqual(['keys', 'jump']);
});

/** The live scene, as the tests below need it. */
type LiveStore = { scene: Scene; getState(): { activeFigure: string; time: number; library: { clips?: { id: string; name: string }[] } } };
const live = (page: Page) =>
  page.evaluate(() => {
    const store = (window as unknown as { __poseStudio: { store: LiveStore } }).__poseStudio.store;
    return { scene: store.scene, active: store.getState().activeFigure, time: store.getState().time, motions: store.getState().library.clips ?? [] };
  });

/** Right-click a point on the floor and pick from its menu. */
async function floorMenu(page: Page, at: number[], item: string | RegExp) {
  // (Once the view has stopped moving: the point is where it stays on screen.)
  let p = await projectPoint(page, at);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const q = await projectPoint(page, at);
    if (Math.hypot(q.x - p.x, q.y - p.y) < 0.5) break;
    p = q;
  }
  const canvas = (await page.locator('.stage canvas').boundingBox())!;
  expect(p.y, 'the point is on screen').toBeLessThan(canvas.y + canvas.height - 10);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

test('a right-click menu taller than the window scrolls with the wheel and shows which way there is more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 440 });
  const canvas = (await page.locator('.stage canvas').boundingBox())!;
  await page.mouse.click(canvas.x + 40, canvas.y + 40, { button: 'right' });
  const list = page.locator('.context-menu');
  await expect(list).toBeVisible();
  await expect(list.locator('.menu-scroll.down.on')).toBeVisible();
  await expect(list.locator('.menu-scroll.up.on')).toHaveCount(0);
  // The wheel over it scrolls it (it stays open); more above now.
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await expect(list.locator('.menu-scroll.up.on')).toBeVisible();
  await expect(list).toBeVisible();
  // The wheel elsewhere closes it.
  await page.mouse.move(canvas.x + canvas.width - 40, canvas.y + 40);
  await page.mouse.wheel(0, 100);
  await expect(list).toHaveCount(0);
});

test('the command palette finds commands, scenes and Library items; Move to… walks a figure to a spot picked on the floor', async ({ page }) => {
  const find = async (text: string) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox', { name: 'Find a command' }).fill(text);
    return palette;
  };
  // A Library item, found by the Library's own search: a pose on the selected figure.
  await (await outline(page, 'Cast')).getByRole('button').first().click();
  const before = (await figs(page))[0].bones;
  await (await find('cobra')).getByRole('option', { name: /^Poses: Cobra/ }).click();
  await expect.poll(async () => (await figs(page))[0].bones).not.toEqual(before);
  // A command with its key, and a command's choice.
  let palette = await find('mirror');
  await expect(palette.getByRole('option', { name: /^Mirror pose/ })).toContainText('M');
  await page.keyboard.press('Escape');
  palette = await find('render style anime');
  await palette.getByRole('option', { name: 'Render style: Anime' }).click();
  await expect(page.getByRole('button', { name: 'Render style' })).toContainText('Anime');

  // Move to…: pick Walk, then a spot on the floor (the hint says what to do).
  await page.getByRole('button', { name: 'Move to…' }).click();
  await page.getByRole('menuitem', { name: 'Walk to…' }).click();
  await expect(page.locator('.bar-hint')).toHaveText(/^Click the floor where Figure should walk/);
  const p = await projectPoint(page, [0.8, 0, -1.2]);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.bar-hint')).not.toHaveText(/^Click the floor/);
  const s = await live(page);
  const track = actionsOf(s.scene.animation!, s.active);
  expect(track[1].source).toMatchObject({ mode: 'walk' });
  expect(track[1].roles[0].end!.at[0]).toBeCloseTo(0.8, 1);
});

test('the view widget, isolate, hover links, dragging from the Library, resizable panels and the dark theme', async ({ page }) => {
  // Many steps, each a frame or more of software rendering.
  test.setTimeout(240_000);
  const yaw = () => page.evaluate(() => Math.round((window as unknown as { __poseStudio: { viewport: { current: { getView(): { yaw: number } } } } }).__poseStudio.viewport.current.getView().yaw));
  // The view widget turns the view as the keys 1–6 do.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'From the left' }).click();
  await expect.poll(yaw).toBe(90);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'From the front' }).click();
  await expect.poll(yaw).toBe(0);

  // Isolate (/): only the selected figure on the canvas, and back.
  await addLayer(page, 'Figure');
  const [first, second] = await figs(page);
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure 2/ }).click();
  await page.keyboard.press('/');
  await expect(page.locator('.bar-hint')).toHaveText(/^Only Figure 2/);
  await page.keyboard.press('/');
  await expect(page.locator('.bar-hint')).not.toHaveText(/^Only/);

  // Resting on an outline row links its figure on the canvas.
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure$/ }).hover();
  await expect.poll(() => state(page).then((x) => (x as unknown as { linked: string | null }).linked)).toBe(first.id);

  // A pose dragged from the Library onto the figure that is not selected: it takes it.
  await openSection(page, 'Library');
  await libraryShows(page, 'Poses');
  const chest = await page.evaluate((id) => (window as unknown as { __poseStudio: Hook }).__poseStudio.viewport.current!.project(id, 'chest')!, first.id);
  const canvas = (await page.locator('.stage canvas').boundingBox())!;
  await page.getByRole('region', { name: 'Poses' }).getByRole('button', { name: 'Cobra', exact: true })
    .dragTo(page.locator('.stage canvas'), { targetPosition: { x: chest.x - canvas.x, y: chest.y - canvas.y } });
  const [a, b] = await figs(page);
  expect(a.bones).not.toEqual(first.bones);
  expect(b.bones).toEqual(second.bones);

  // The inspector is as wide as its edge is dragged, after a reload too.
  const edge = (await page.locator('.panel-edge.left').boundingBox())!;
  await drag(page, { x: edge.x + 3, y: edge.y + 200 }, { x: edge.x - 57, y: edge.y + 200 });
  const wide = (await page.locator('.panel').boundingBox())!.width;
  expect(wide).toBeGreaterThan(330);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  expect(Math.abs((await page.locator('.panel').boundingBox())!.width - wide)).toBeLessThan(2);

  // The dark theme, from the main menu.
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('adding is placing: a ghost follows the pointer, snaps beside a figure and turns; F frames the selection', async ({ page }) => {
  await openSection(page, 'Scene');
  await page.getByRole('button', { name: 'Add to cast' }).click();
  await page.getByRole('menuitem', { name: 'Figure', exact: true }).click();
  // Beside the figure there: the hint says so.
  const spot = await projectPoint(page, [0.6, 0, 0.05]);
  await page.mouse.move(spot.x - 30, spot.y);
  await page.mouse.move(spot.x, spot.y);
  await expect(page.locator('.bar-hint')).toHaveText(/^Beside Figure/);
  await page.mouse.click(spot.x, spot.y);
  let s = await live(page);
  expect(s.scene.figures).toHaveLength(2);
  expect(s.scene.figures[1].position).toEqual([0.6, 0, 0]);
  // A box: on the 25 cm grid, turned 15° by R.
  await page.getByRole('button', { name: 'Add to set' }).click();
  await page.getByRole('menuitem', { name: 'Box', exact: true }).click();
  const floor = await projectPoint(page, [-0.62, 0, -0.9]);
  await page.mouse.move(floor.x - 20, floor.y);
  await page.mouse.move(floor.x, floor.y);
  await page.keyboard.press('r');
  await page.mouse.click(floor.x, floor.y);
  s = await live(page);
  expect(s.scene.props[0].position).toEqual([-0.5, 0, -1]);
  expect(s.scene.props[0].rotation[1]).toBe(15);
  // F frames what is selected (the box), not everything.
  await page.keyboard.press('f');
  await expect.poll(async () => {
    const box = await projectPoint(page, [-0.5, 0.25, -1]);
    const c = (await page.locator('.stage canvas').boundingBox())!;
    return Math.abs(box.x - (c.x + c.width / 2)) < c.width * 0.15;
  }).toBe(true);
});

test('a joint clicked (its figure picked) is selected, named in the inspector; its menu has the joint\'s commands', async ({ page }) => {
  await page.keyboard.press('1');
  const elbow = await project(page, 'leftLowerArm');
  const hand = await project(page, 'leftHand');
  const at = { x: (elbow.x + hand.x) / 2, y: (elbow.y + hand.y) / 2 };
  await pickPart(page, at);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __poseStudio: { store: { getState(): { selection: unknown } } } }).__poseStudio.store.getState().selection)).toMatchObject({ kind: 'joint', joint: 'leftLowerArm' });
  expect(angle((await state(page)).scene.figures[0].bones, 'leftLowerArm')).not.toEqual([0, 0, 0]);
  // Right-click it: the joint stays selected, and its menu resets it.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset the joint' }).click();
  expect(angle((await state(page)).scene.figures[0].bones, 'leftLowerArm')).toEqual([0, 0, 0]);
});

test('the timeline is always there: what a figure does next from its + at the playhead; a Library pose dropped on its row at a time', async ({ page }) => {
  test.setTimeout(240_000);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  expect((await live(page)).scene.animation).toBeFalsy();
  // A still scene: Add an action, walk, then a spot on the floor.
  await timeline.getByRole('button', { name: 'Add an action' }).click();
  const picker = page.getByRole('dialog', { name: 'What Figure does next' });
  await picker.getByRole('textbox', { name: 'Find an action' }).fill('walk');
  await page.keyboard.press('Enter');
  await expect(page.locator('.bar-hint')).toHaveText(/^Click the floor where Figure should walk/);
  const p = await projectPoint(page, [0.8, 0, -1.2]);
  await page.mouse.click(p.x, p.y);
  let s = await live(page);
  expect(actionsOf(s.scene.animation!, s.active).map((x) => x.source.kind)).toEqual(['keys', 'travel']);
  // The row's + at the playhead (the walk's end): a motion from there.
  const end = s.time;
  await timeline.getByRole('button', { name: /^What Figure does next, from/ }).click();
  await picker.getByRole('menuitem', { name: /^Wave hello/ }).click();
  s = await live(page);
  const wave = actionsOf(s.scene.animation!, s.active).find((x) => x.source.kind === 'clip')!;
  expect(wave.start).toBeCloseTo(end, 1);
  // A pose dragged from the Library onto the row, a quarter of the way along: keyed there (over the walk: a correction to it).
  await openSection(page, 'Library');
  const row = page.getByRole('region', { name: 'Timeline' }).locator('.tl-row').nth(1);
  const box = (await row.boundingBox())!;
  await page.getByRole('region', { name: 'Poses' }).getByRole('button', { name: 'Cobra', exact: true }).dragTo(row, { targetPosition: { x: box.width / 4, y: box.height / 2 } });
  s = await live(page);
  const at = shownTime(s.scene.animation!.duration) / 4;
  expect([...keyTimesOf(s.scene.animation!, s.active), ...correctionTimesOf(s.scene.animation!, s.active)].some((t) => Math.abs(t - at) < 0.15)).toBe(true);
});

test('relations by pointing: a hand let go on someone holds on there; who to look at is clicked on the canvas', async ({ page }) => {
  test.setTimeout(240_000);
  await page.keyboard.press('1');
  await addLayer(page, 'Figure');
  await page.waitForTimeout(400);
  await animate(page);
  const [first, second] = (await live(page)).scene.figures;
  const at = (figure: string, joint: string) => page.evaluate(([f, j]) => (window as unknown as { __poseStudio: Hook }).__poseStudio.viewport.current!.project(f, j)!, [figure, joint]);
  // The second's hand nearer the first, dragged onto the first's chest: it holds on there from the playhead.
  // (Where they are on screen once the view has settled; a press that missed the hand, once more.)
  await page.waitForTimeout(800);
  const held = () => live(page).then((x) => x.scene.animation?.constraints?.[0]);
  for (let attempt = 0; attempt < 2 && !(await held()); attempt++) {
    const [l, r] = [await at(second.id, 'leftHand'), await at(second.id, 'rightHand')];
    const chest = await at(first.id, 'chest');
    await drag(page, Math.abs(l.x - chest.x) < Math.abs(r.x - chest.x) ? l : r, chest);
    // (The hold is made as the drag is let go: on a slow machine, a moment later.)
    await page.waitForTimeout(1500);
  }
  await expect.poll(held).toMatchObject({ figure: second.id, target: { figure: first.id } });
  let s = await live(page);
  // Eyes on: what is clicked on the canvas.
  const head = await at(second.id, 'head');
  await page.mouse.click(head.x, head.y + 4, { button: 'right' });
  await page.getByRole('menuitem', { name: 'What you click…' }).click();
  await expect(page.locator('.bar-hint')).toHaveText(/^Click a figure or a prop for Figure 2 to look at/);
  const face = await at(first.id, 'head');
  await page.mouse.click(face.x, face.y + 4);
  s = await live(page);
  expect(s.scene.figures.find((f) => f.id === second.id)!.gaze).toEqual({ figure: first.id });
});

test('several things at once: Shift-click adds to the selection; they move together, duplicate and delete as one', async ({ page }) => {
  test.setTimeout(240_000);
  await page.keyboard.press('1');
  await addLayer(page, 'Figure');
  await page.waitForTimeout(400);
  const [first, second] = (await live(page)).scene.figures;
  // Shift-click the other figure in the outline: both selected.
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure$/ }).click();
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure 2/ }).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('2 selected');
  // Dragging one moves both.
  const chest = await project(page, 'chest');
  await drag(page, { x: chest.x, y: chest.y - 20 }, { x: chest.x + 80, y: chest.y - 20 });
  let s = await live(page);
  const moved = (id: string, before: { position: number[] }) => s.scene.figures.find((f) => f.id === id)!.position[0] - before.position[0];
  expect(moved(first.id, first)).toBeGreaterThan(0.1);
  expect(moved(second.id, second)).toBeCloseTo(moved(first.id, first), 1);
  // Ctrl+D copies both (one step); Delete removes the copies, one undo brings them back.
  await page.keyboard.press('Control+d');
  expect((await live(page)).scene.figures).toHaveLength(4);
  await page.keyboard.press('Delete');
  expect((await live(page)).scene.figures).toHaveLength(2);
  await page.keyboard.press('Control+z');
  s = await live(page);
  expect(s.scene.figures).toHaveLength(4);
});

test('steps from the keyboard: arrows move what is selected, Alt turns it, Shift goes three steps; a joint\'s slider; the light', async ({ page }) => {
  test.setTimeout(240_000);
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure$/ }).click();
  // The hint says what the keys do (once the next step it suggests is put off).
  while (await page.getByRole('button', { name: 'Not now' }).isVisible()) await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.bar-hint')).toContainText('Arrows: move Figure');
  const at = async () => (await live(page)).scene.figures[0].position;
  const x0 = (await at())[0];
  // From the front, → is +X: 5 cm, then three steps with Shift.
  await page.keyboard.press('ArrowRight');
  expect((await at())[0]).toBeCloseTo(x0 + 0.05, 3);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await at())[0]).toBeCloseTo(x0 + 0.2, 3);
  // Alt + ←: it turns 15° to its left.
  const yaw = async () => facingOf((await live(page)).scene.figures[0].bones);
  const y0 = await yaw();
  await page.keyboard.press('Alt+ArrowLeft');
  expect(Math.round((((await yaw()) - y0 + 540) % 360) - 180)).toBe(15);
  // A joint: X held with ← steps its Bend 5°.
  const elbow = await project(page, 'leftLowerArm');
  const hand = await project(page, 'leftHand');
  await page.mouse.click((elbow.x + hand.x) / 2, (elbow.y + hand.y) / 2);
  // (Off the figure: on it, the hint says what a drag of what is under the pointer does.)
  await page.mouse.move(150, 600);
  await expect(page.locator('.bar-hint')).toContainText('X / Y / Z + ← →:');
  const bend = async () => angle((await live(page)).scene.figures[0].bones, 'leftLowerArm')[0];
  const b0 = await bend();
  await page.keyboard.down('x');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('x');
  expect(await bend()).toBeCloseTo(b0 - 5, 0);
  await expect(page.locator('.drag-readout')).toHaveText(/^Left forearm · Bend −?\d+°$/);
  // The light: ← moves it round 15°.
  await openSection(page, 'Scene');
  await (await outline(page, 'Lights')).getByRole('button', { name: 'Key light', exact: true }).click();
  const az = async () => (await live(page)).scene.lighting?.lights[0].azimuth ?? 40;
  const a0 = await az();
  await page.keyboard.press('ArrowLeft');
  expect(await az()).toBeCloseTo(a0 + 15, 0);
});

test('a whole performance moves and turns as one, without a key: Ctrl + arrows, the inspector, Move it all here', async ({ page }) => {
  test.setTimeout(240_000);
  await floorMenu(page, [0.8, 0, -1.2], 'Walk here');
  let s = await live(page);
  const id = s.active!;
  const keys = keyTimesOf(s.scene.animation!, id);
  const end = (x: typeof s) => actionsOf(x.scene.animation!, id)[1].roles[0].end!.at;
  const start = (x: typeof s) => actionsOf(x.scene.animation!, id)[0];
  const [ex, ez] = end(s);
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure animated$/ }).click();
  // From the front, Ctrl → moves all it does 5 cm along +X, Shift three steps more; no key is added.
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Control+Shift+ArrowRight');
  s = await live(page);
  expect(end(s)[0]).toBeCloseTo(ex + 0.2, 2);
  expect(end(s)[1]).toBeCloseTo(ez, 2);
  expect(keyTimesOf(s.scene.animation!, id)).toEqual(keys);
  // The figure is where its walk now ends (the playhead is there).
  expect(s.scene.figures.find((f) => f.id === id)!.position[0]).toBeCloseTo(ex + 0.2, 2);

  // The inspector: where it starts, typed; all it does follows.
  const x0 = (await page.getByRole('textbox', { name: 'Whole performance X' }).inputValue());
  await page.getByRole('textbox', { name: 'Whole performance X' }).fill(String(Number(x0) - 0.2));
  await page.getByRole('textbox', { name: 'Whole performance X' }).press('Enter');
  s = await live(page);
  expect(end(s)[0]).toBeCloseTo(ex, 2);
  expect(start(s).source.kind).toBe('keys');

  // Ctrl + Alt + → turns it about where it is now (the walk's end): the end stays, the start swings round.
  await page.keyboard.press('Control+Alt+ArrowRight');
  s = await live(page);
  expect(end(s)[0]).toBeCloseTo(ex, 2);
  expect(keyTimesOf(s.scene.animation!, id)).toEqual(keys);

  // Right-click the floor: the whole performance there (the figure is there at the playhead).
  await page.keyboard.press('Escape');
  await floorMenu(page, [-0.6, 0, -1.5], 'Move it all here');
  s = await live(page);
  expect(end(s)[0]).toBeCloseTo(-0.6, 1);
  expect(end(s)[1]).toBeCloseTo(-1.5, 1);
  expect(keyTimesOf(s.scene.animation!, id)).toEqual(keys);
});

test('Scene only: the scene filling the window, its button again or Esc back', async ({ page }) => {
  await page.getByRole('button', { name: 'Scene only' }).click();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Sections' })).toBeHidden();
  const box = await page.locator('.stage canvas').boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.y).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.topbar')).toBeVisible();
  await page.keyboard.press('Shift+F');
  await expect(page.locator('.topbar')).toBeHidden();
  await page.getByRole('button', { name: 'Back to the panels' }).click();
  await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible();
  // With the inspector folded away too, the canvas still fills the window (not squeezed to nothing).
  await page.keyboard.press('i');
  await page.getByRole('button', { name: 'Scene only' }).click();
  await expect.poll(async () => (await page.locator('.stage canvas').boundingBox())?.width).toBeGreaterThan(1000);
  await page.keyboard.press('Escape');
  await page.keyboard.press('i');
});

test('the panels by the keyboard (#20): one Tab stop per list, the arrows inside; the outline selects as it moves; Shift+F10 opens a row\'s menu', async ({ page }) => {
  await templateScene(page, 'Café meeting');
  const focused = () => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim());
  // The rail: ↑ ↓ between its tabs, the panel following.
  const rail = page.getByRole('tablist', { name: 'Sections' });
  await rail.getByRole('tab', { name: 'Scene', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rail.getByRole('tab', { name: 'Characters' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(rail.getByRole('tab', { name: 'Scene', exact: true })).toHaveAttribute('aria-selected', 'true');
  // The outline: one stop for its rows (their ⋯ and eye are none); ↓ moves and selects.
  const lea = (await outline(page, 'Cast')).getByRole('button', { name: /^Lea/ });
  await lea.focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toMatch(/^Ben/);
  const now = await live(page);
  expect(now.scene.figures.find((f) => f.id === now.active)?.name).toBe('Ben');
  await page.keyboard.press('Tab');
  expect(await focused()).not.toMatch(/^More for|^Hide/);
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toMatch(/^Ben/);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await page.keyboard.press('Escape');
  // A segmented control: one stop, the arrows choose.
  await page.keyboard.press('Control+e');
  const pass = page.getByRole('radiogroup', { name: 'Pass' });
  await pass.getByRole('radio', { name: 'Picture' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(pass.getByRole('radio', { name: 'Depth' })).toHaveAttribute('aria-checked', 'true');
  expect(await pass.getByRole('radio', { name: 'Normals' }).getAttribute('tabindex')).toBe('-1');
});

test('Tab goes from thing to thing in the scene, Shift + Tab back; in the panels it moves the focus', async ({ page }) => {
  const sel = () => page.evaluate(() => (window as unknown as { __poseStudio: { store: { getState(): { selection: { kind: string } | null } } } }).__poseStudio.store.getState().selection);
  const scene = await live(page);
  const things = scene.scene.figures.length + scene.scene.props.length + scene.scene.cameras.length + 1;
  // Before the canvas is clicked, Tab is the browser's (a keyboard user reaches the controls).
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  expect((await sel())?.kind).toBe('figure');
  for (let i = 1; i < things; i++) await page.keyboard.press('Tab');
  expect((await sel())?.kind).toBe('light');
  await page.keyboard.press('Tab');
  expect((await sel())?.kind).toBe('figure');
  await page.keyboard.press('Shift+Tab');
  expect((await sel())?.kind).toBe('light');
  // In the panels, Tab is the browser's.
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button').first().focus();
  await page.keyboard.press('Tab');
  expect((await sel())?.kind).toBe('light');
});

test('figures walk, run and jump to marks from the floor menu; the timeline says how they get there', async ({ page }) => {
  await floorMenu(page, [0.8, 0, -1.2], 'Walk here');
  let s = await live(page);
  let track = actionsOf(s.scene.animation!, s.active);
  expect(track.map((x) => x.source.kind)).toEqual(['keys', 'travel']);
  expect(track[1].source).toMatchObject({ mode: 'walk' });
  expect(track[1].roles[0].end!.at[0]).toBeCloseTo(0.8, 1);
  expect(track[1].roles[0].end!.at[1]).toBeCloseTo(-1.2, 1);
  // The playhead waits at the new mark; the next one chains on.
  expect(s.time).toBeCloseTo(track[1].start + track[1].duration, 1);
  await floorMenu(page, [-0.8, 0, -2.4], 'Run here');
  s = await live(page);
  track = actionsOf(s.scene.animation!, s.active);
  expect(track.map((x) => (x.source.kind === 'travel' ? x.source.mode : null))).toEqual([null, 'walk', 'run']);

  // Right-click the walk on the timeline: jump there instead, with a full turn.
  const box = (await page.locator('[aria-label="Pose keys"]').boundingBox())!;
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const x = lanes.x + (lanes.width * (track[1].start + track[1].duration / 2)) / shownTime(s.scene.animation!.duration);
  await page.mouse.click(x, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Jump', exact: true }).click();
  await page.mouse.click(x, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Full turn' }).click();
  s = await live(page);
  expect(actionsOf(s.scene.animation!, s.active)[1].source).toMatchObject({ mode: 'jump', spin: 1 });
});

test('the timeline (#19): clicked in, it takes the keys; its ruler and Shots stay as its rows scroll; a drag at the edge of a zoomed view scrolls on', async ({ page }) => {
  test.setTimeout(150_000);
  await templateScene(page, 'House party');
  const store = () => live(page);
  const lanes = page.locator('.tl-lanes');
  let box = (await lanes.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + 8);
  expect(await page.evaluate(() => !!document.activeElement?.closest('.tl-tracks'))).toBe(true);
  // A frame on, two; the next key; the end; the start.
  const t0 = (await store()).time;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const fps = (await store()).scene.animation!.fps;
  expect((await store()).time).toBeCloseTo(t0 + 2 / fps, 3);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await store()).time).toBeGreaterThan(t0 + 2 / fps);
  await page.keyboard.press('End');
  expect((await store()).time).toBeCloseTo((await store()).scene.animation!.duration, 2);
  await page.keyboard.press('Home');
  expect((await store()).time).toBe(0);
  // The person below, and on to the last: their row in sight under the ruler and Shots, which stay.
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setSettings(s: object): void } } }).__poseStudio.store.setSettings({ timelineHeight: 150 }));
  const people = (await store()).scene.figures;
  for (let i = 0; i < people.length; i++) await page.keyboard.press('ArrowDown');
  expect((await store()).active).toBe(people.at(-1)!.id);
  const tracks = (await page.locator('.tl-tracks').boundingBox())!;
  await expect.poll(async () => page.locator('.tl-tracks').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect((await page.locator('.tl-ruler').boundingBox())!.y).toBeCloseTo(tracks.y, 0);
  const last = (await page.locator(`.tl-row[data-row="${people.at(-1)!.id}"]`).boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(tracks.y + tracks.height + 1);
  // Zoomed in, the playhead dragged to the right edge and held there: the window scrolls on.
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await expect(page.locator('.tl-scroll')).toBeVisible();
  // Its scrollbar at the bottom of the tracks in sight, not below the rows scrolled away.
  const bar = (await page.locator('.tl-scroll').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(tracks.y + tracks.height + 1);
  expect(bar.y + bar.height).toBeGreaterThan(tracks.y + tracks.height - 24);
  box = (await lanes.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, tracks.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, tracks.y + 8, { steps: 4 });
  const at = (await store()).time;
  await page.waitForTimeout(1500);
  expect((await store()).time).toBeGreaterThan(at + 1);
  await page.mouse.up();
  // Esc gives the keys back to the canvas.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.tl-tracks'))).toBe(false);
  // Made taller than its rows (its top edge dragged up): the scrollbar at its bottom, not under the last row.
  await page.evaluate(() => (window as unknown as { __poseStudio: { store: { setSettings(s: object): void } } }).__poseStudio.store.setSettings({ timelineHeight: 420 }));
  await expect.poll(async () => {
    const [t, b] = [(await page.locator('.tl-tracks').boundingBox())!, (await page.locator('.tl-scroll').boundingBox())!];
    return t.y + t.height - (b.y + b.height);
  }).toBeLessThan(24);
});

test('actions are blocks on the timeline: picked for the inspector, retimed by their edge, blended by their ramp', async ({ page }) => {
  await floorMenu(page, [0.8, 0, -1.2], 'Walk here');
  let s = await live(page);
  const walk = () => live(page).then((x) => actionsOf(x.scene.animation!, x.active).find((a) => a.source.kind === 'travel' && a.source.mode === 'walk')!);
  const before = await walk();
  // Picked: the inspector shows how it gets there and its timing.
  await page.locator('.tl-travel.walk').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByLabel('Action')).toHaveText('Walk');
  await expect(inspector.getByRole('radiogroup', { name: 'Getting there' })).toBeVisible();
  // Its right edge drags half a second longer.
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const box = (await page.locator('.tl-travel.walk').boundingBox())!;
  const perSecond = lanes.width / shownTime(s.scene.animation!.duration);
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width - 2 + (perSecond * 0.5 * i) / 5, box.y + box.height / 2);
  await page.mouse.up();
  expect((await walk()).duration - before.duration).toBeGreaterThan(0.3);
  // A run put in before it (the playhead went to the walk's start): the walk's ramp drags out, and it blends in.
  await floorMenu(page, [-0.8, 0, -2.4], 'Run here');
  s = await live(page);
  const ramp = (await page.locator('.tl-ramp.walk').boundingBox())!;
  const perSecond2 = lanes.width / shownTime(s.scene.animation!.duration);
  await page.mouse.move(ramp.x + ramp.width / 2, ramp.y + ramp.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(ramp.x + ramp.width / 2 - (perSecond2 * 0.3 * i) / 5, ramp.y + ramp.height / 2);
  await page.mouse.up();
  expect((await walk()).blendIn ?? 0).toBeGreaterThan(0.15);
  // The walk runs instead, from the inspector.
  await page.locator('.tl-travel.walk').click({ position: { x: 20, y: 5 } });
  await expect(inspector.getByLabel('Action')).toHaveText('Walk');
  await inspector.getByRole('radio', { name: 'Run' }).click();
  expect(actionsOf((await live(page)).scene.animation!, s.active).filter((a) => a.source.kind === 'travel').map((a) => (a.source as { mode: string }).mode)).toEqual(['run', 'run']);
});

test('a motion block\'s edges trim it; Alt-drag stretches it (#22)', async ({ page }) => {
  await sceneWithMotion(page, 'Baseball swing');
  const motion = () => live(page).then((x) => actionsOf(x.scene.animation!, x.active).find((a) => a.source.kind === 'clip')!);
  const before = await motion();
  const s = await live(page);
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const perSecond = lanes.width / shownTime(s.scene.animation!.duration);
  const drag = async (x: number, y: number, by: number, alt = false) => {
    await page.mouse.move(x, y);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(x + (by * perSecond * i) / 5, y);
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
  };
  const block = () => page.locator('.tl-travel.clip').first().boundingBox().then((b) => b!);
  // Its right edge half a second in: it plays less of the motion, at the same speed.
  let box = await block();
  await drag(box.x + box.width - 2, box.y + box.height / 2, -0.5);
  let now = await motion();
  expect(before.duration - now.duration).toBeGreaterThan(0.3);
  expect(now.source).toMatchObject({ kind: 'clip', to: expect.any(Number) });
  expect((now.source as { speed?: number }).speed ?? 1).toBeCloseTo(1, 2);
  // Its left edge: it starts later, its end where it was.
  box = await block();
  // (Above the key at its start.)
  await drag(box.x + 2, box.y + 2, 0.4);
  const trimmed = await motion();
  expect(trimmed.start - now.start).toBeGreaterThan(0.2);
  expect(trimmed.start + trimmed.duration).toBeCloseTo(now.start + now.duration, 2);
  expect((trimmed.source as { from?: number }).from).toBeGreaterThan(0.2);
  // Alt: stretched, the part it plays kept.
  box = await block();
  await drag(box.x + box.width - 2, box.y + box.height / 2, 0.6, true);
  now = await motion();
  expect(now.duration - trimmed.duration).toBeGreaterThan(0.3);
  expect((now.source as { speed?: number }).speed).toBeLessThan(0.9);
  expect((now.source as { from?: number; to?: number }).to).toBe((trimmed.source as { to?: number }).to);
});

test('a held prop is thrown to a spot on the floor, keyed over time', async ({ page }) => {
  await addLayer(page, 'Stick');
  let s = await live(page);
  expect(s.scene.props[0].hold).toBeTruthy();
  await animate(page);
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  for (let i = 0; i < 6; i++) await page.keyboard.press('.');
  await floorMenu(page, [1.2, 0, -1], /^Throw .* here$/);
  s = await live(page);
  // A throw on the figure's upper body, sending it there; the stick's row says when it flies.
  expect(s.scene.animation!.actions.find((x) => x.prop === s.scene.props[0].id)?.target).toEqual({ at: [1.2, -1] });
  await expect(page.locator('.tl-travel.throw').first()).toBeVisible();
});

test('a motion goes on the selected figure only', async ({ page }) => {
  await addLayer(page, 'Figure');
  const [, second] = (await live(page)).scene.figures;
  const scenes = (await state(page)).library.scenes.length;
  await openSection(page, 'Library');
  await libraryShows(page, 'Motions');
  await page.getByRole('region', { name: 'Motions' }).getByRole('button', { name: /^Jab & cross [\d.]+ s$/ }).click();
  // In this scene (no new one), on the selected figure alone: people together each get their own motion.
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  expect((await state(page)).library.scenes).toHaveLength(scenes);
  const s = await live(page);
  expect(s.scene.animation!.actions.filter((x) => x.source.kind === 'clip').map((x) => x.roles.map((r) => r.figure))).toEqual([[second.id]]);

  // The first takes the hit: timed to land with the second's punch.
  await openSection(page, 'Scene');
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure\b/ }).first().click();
  await libraryShows(page, 'Motions');
  await page.getByRole('region', { name: 'Motions' }).getByRole('button', { name: /^Take a hit [\d.]+ s$/ }).click();
  const hit = () => live(page).then((x) => x.scene.animation!.actions.find((a) => a.source.kind === 'clip' && a.roles[0].figure !== second.id)!);
  const before = (await hit()).start;
  await page.locator('.tl-travel', { hasText: 'Take a hit' }).click({ button: 'right' });
  // (Under React to: everyone else's motions.)
  await page.getByRole('menuitem', { name: /: Jab & cross/ }).click();
  await expect.poll(async () => (await hit()).start).not.toBe(before);
});

test('sports gear: dribble and shoot at a basketball hoop, toss a gym hoop, a ribbon; the high jump set-up', async ({ page }) => {
  await addLayer(page, 'Basketball hoop');
  await addLayer(page, 'Ball');
  const propMenu = async (name: string, item: string | RegExp) => {
    // A held prop's row also says whose hand it is in.
    await (await outline(page, 'Set')).getByRole('button', { name: new RegExp(`^${name}( In|$)`) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: item }).click();
  };
  await propMenu('Ball', /right hand$/);
  await propMenu('Ball', 'Dribble (2 s)');
  let s = await live(page);
  const ball = s.scene.props.find((p) => p.kind === 'sphere')!.id;
  const handling = () => s.scene.animation!.actions.filter((x) => x.prop === ball);
  expect(handling().map((x) => [x.source.kind === 'clip' && x.source.clip, x.duration])).toEqual([['motion:dribble', 2]]);
  expect(s.time).toBeCloseTo(2, 2);
  await propMenu('Ball', /^Basketball hoop$/);
  s = await live(page);
  // Through the rim, then down and bouncing on the floor: the animation runs on until it is down.
  expect(handling().at(-1)!.target).toMatchObject({ hoop: expect.any(String) });
  expect(s.scene.animation!.duration).toBeGreaterThan(s.time + 0.5);

  await addLayer(page, 'Gym hoop');
  await propMenu('Gym hoop', 'Toss up and catch');
  s = await live(page);
  const ring = s.scene.props.find((p) => p.kind === 'ring')!.id;
  // Up from her hand and back into it.
  expect(s.scene.animation!.actions.find((x) => x.prop === ring)!.target).toMatchObject({ figure: s.active, rise: 2 });

  // A ribbon goes in the other hand; it trails its stick as drawn (not kept in the scene).
  await addLayer(page, 'Ribbon');
  s = await live(page);
  expect(s.scene.props.find((p) => p.kind === 'ribbon')!.hold).toBeTruthy();
  expect(s.scene.props.some((p) => 'trail' in p)).toBe(false);

  await templateScene(page, 'High jump');
  s = await live(page);
  expect(s.scene.props.map((p) => p.kind).sort()).toEqual(['bar', 'mat']);
  // A generated run-up, then the flop keyed frame by frame.
  expect(s.scene.animation!.actions.some((x) => x.source.kind === 'travel' && x.source.mode === 'run')).toBe(true);
});

test('eyes on another figure, figure colours, a shot subject and the scene light', async ({ page }) => {
  // Two figures drawn in software (no GPU here): every step is slow.
  test.setTimeout(240_000);
  await addLayer(page, 'Figure');
  let s = await live(page);
  const [first, second] = s.scene.figures;
  expect(s.active).toBe(second.id);
  await unfold(page, 'With others');
  await choose(page, 'Eyes on', first.name);
  s = await live(page);
  expect(s.scene.figures[1].gaze).toEqual({ figure: first.id });

  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('radiogroup', { name: 'Colour' }).getByRole('radio').nth(1).click();
  s = await live(page);
  expect(s.scene.figures[1].color).toMatch(/^#/);

  // A shot that follows one figure.
  await openSection(page, 'Scene');
  await animate(page);
  await page.locator('.tl-shot').first().click();
  await openShotCamera(page);
  await choose(page, 'Camera subject', second.name);
  s = await live(page);
  expect(s.scene.cameras.find((c) => c.id === s.scene.animation!.shots[0].camera)!.subject).toBe(second.id);
  // A two-shot: the other with them.
  await page.getByRole('group', { name: 'Frames with' }).getByRole('button', { name: `with ${first.name}` }).click();
  s = await live(page);
  expect(s.scene.cameras.find((c) => c.id === s.scene.animation!.shots[0].camera)!.also).toEqual([first.id]);
  // Or filmed with a coverage of the two (the director's Conversation, on the timeline): a master, over-the-shoulder shots and singles.
  await page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: 'Director' }).click();
  await page.getByRole('menuitemradio', { name: 'Conversation' }).or(page.getByRole('menuitem', { name: 'Conversation' })).click();
  s = await live(page);
  expect(s.scene.cameras.filter((c) => c.made?.startsWith('dialogue:'))).toHaveLength(5);
  expect(s.scene.cameras.find((c) => c.id === s.scene.animation!.shots[0].camera)!.name).toBe('Master');

  // The key light, selected in the outline: in Line art it says where it shows, and switches to Clay.
  await openSection(page, 'Scene');
  await (await outline(page, 'Lights')).getByRole('button', { name: 'Key light', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to Clay' }).click();
  await expect(page.getByRole('button', { name: 'Render style' })).toContainText('Clay');
  // The Dusk scheme (from the Library's Lighting), kept with the scene: a low warm key light and a cool fill.
  await openSection(page, 'Library');
  await libraryShows(page, 'Lighting');
  await page.getByRole('region', { name: 'Lighting' }).getByRole('button', { name: 'Dusk', exact: true }).click();
  await openSection(page, 'Scene');
  s = await live(page);
  expect(s.scene.lighting!.lights.map((l) => [l.kind, l.name])).toEqual([['sun', 'Key light'], ['sun', 'Fill light']]);
  expect(s.scene.lighting!.lights[0].kelvin).toBeLessThanOrEqual(3000);
  await expect((await outline(page, 'Lights')).getByRole('button', { name: 'Fill light', exact: true })).toBeVisible();
  // The key light lit from the left, from the view (its menu).
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('3');
  await page.waitForTimeout(400);
  await (await outline(page, 'Lights')).getByRole('button', { name: 'Key light', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Light from this view' }).click();
  s = await live(page);
  expect(Math.abs(s.scene.lighting!.lights[0].azimuth - 90)).toBeLessThan(5);
  await expect(page.getByText(/^From the left, /)).toBeVisible();
  // A rim light added (a lamp put behind the people, selected), a street lamp's colour: Alt-click
  // a figure from the front moves it round to the front of them.
  // (Added from the outline's Lights: the new one selected there.)
  await page.getByRole('button', { name: 'Add a light' }).click();
  await page.getByRole('menuitem', { name: 'Rim light' }).click();
  await expect((await outline(page, 'Lights')).locator('li.on')).toContainText('Rim light');
  await page.getByRole('radiogroup', { name: 'Light colour' }).getByRole('radio', { name: 'Street lamp' }).click();
  s = await live(page);
  expect(s.scene.lighting!.lights[2]).toMatchObject({ kind: 'lamp', name: 'Rim light', color: '#ffd09e', shadows: false });
  expect(s.scene.lighting!.lights[2].position[2]).toBeLessThan(0);
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  const chest = await project(page, 'chest');
  await page.keyboard.down('Alt');
  await page.mouse.click(chest.x, chest.y);
  await page.keyboard.up('Alt');
  s = await live(page);
  expect(s.scene.lighting!.lights[2].position[2]).toBeGreaterThan(0.5);
  expect(Math.abs(s.scene.lighting!.lights[2].position[0])).toBeLessThan(1);
  expect(Math.abs(s.scene.lighting!.lights[0].azimuth - 90)).toBeLessThan(5);
});

test('a motion file is imported into My motions and given to the figure', async ({ page }) => {
  await openSection(page, 'Library');
  await libraryShows(page, 'Motions');
  await page.getByLabel('Motion file').setInputFiles({ name: 'Step forward.bvh', mimeType: 'text/plain', buffer: Buffer.from(bvh(CMU)) });
  const mine = page.getByRole('list', { name: 'My motions' });
  await expect(mine.getByRole('button', { name: /^Step forward/ })).toBeVisible();
  expect((await live(page)).motions.map((m) => m.name)).toEqual(['Step forward']);
  await mine.getByRole('button', { name: /^Step forward/ }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  const s = await live(page);
  expect(actionsOf(s.scene.animation!, s.active).map((x) => x.source.kind)).toEqual(['keys', 'clip']);
  // Its frames are kept apart (IndexedDB): after a reload it is listed and still plays.
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  const at = (t: number) => page.evaluate((time) => {
    const store = (window as unknown as { __poseStudio: { store: LiveStore & { setTime(t: number): void } } }).__poseStudio.store;
    store.setTime(time);
    return store.scene.figures.find((f) => f.id === store.getState().activeFigure)!.position[2];
  }, t);
  const clip = actionsOf(s.scene.animation!, s.active)[1];
  await expect.poll(async () => Math.abs((await at(clip.start + clip.duration)) - (await at(clip.start))), { timeout: 15_000 }).toBeGreaterThan(0.1);
  await openSection(page, 'Library');
  await libraryShows(page, 'Motions');
  // Deleting it takes it out of the library (the figure keeps its keys).
  await mine.getByRole('button', { name: 'Delete my motion Step forward' }).click();
  await expect(page.getByRole('list', { name: 'My motions' })).toHaveCount(0);
});

test('a built-in character is fetched only when a figure is drawn as it', async ({ page }) => {
  const fetched: string[] = [];
  // Its thumbnails come with the app; a character's file only when it is used.
  page.on('request', (r) => { if (/\/characters\/.*\.glb(\?|$)/.test(r.url())) fetched.push(r.url()); });
  await openSection(page, 'Library');
  await libraryShows(page, 'Characters');
  const list = page.getByRole('region', { name: 'Characters' });
  await expect(list.getByRole('button', { name: /^Woman/ })).toBeVisible();
  expect(fetched).toEqual([]);
  await list.getByRole('button', { name: /^Woman/ }).click();
  await expect.poll(() => fetched.length).toBe(1);
  expect(fetched[0]).toMatch(/\/characters\/woman\.glb(\?|$)/);
  expect((await state(page)).scene.figures[0] as unknown as { model?: string }).toMatchObject({ model: 'character:woman' });
});

test('a character is imported and the figure drawn as it; bones it cannot name are matched by hand', async ({ page }) => {
  await openSection(page, 'Library');
  await libraryShows(page, 'Characters');
  // Its left hand has a name nobody uses: matched by hand in the dialog.
  const odd = characterGltf(true).replaceAll('mixamorig:LeftHand"', 'mixamorig:Paw"');
  await page.getByLabel('Character file').setInputFiles({ name: 'Hero.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(odd) });
  const dialog = page.getByRole('dialog', { name: /Match the bones of Hero\.gltf/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import' })).toBeDisabled();
  for (const [bone, name] of [['Left hand', 'mixamorigPaw'], ['Left lower arm', 'mixamorigLeftForeArm'], ['Left upper arm', 'mixamorigLeftArm']]) {
    await dialog.getByRole('combobox', { name: bone, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Import' }).click();
  const models = page.getByRole('list', { name: 'My characters' });
  await expect(models.getByRole('button', { name: /^Hero/ })).toBeVisible();
  const figure = () => page.evaluate(() => {
    const store = (window as unknown as { __poseStudio: { store: { figure: { model?: string } | null; getState(): { library: { models?: { id: string; bones: Record<string, string> }[] } } } } }).__poseStudio.store;
    return { model: store.figure?.model, models: store.getState().library.models ?? [] };
  });
  let f = await figure();
  // (Kept named as our skeleton's: the bone matched by hand too.)
  expect(f.models[0].bones.leftHand).toBe('leftHand');
  expect(f.model).toBe(f.models[0].id);
  // Back to the mannequin, and the character again from the inspector after a reload (its file is kept).
  await page.getByRole('list', { name: 'Built in' }).getByRole('button', { name: /^Mannequin/ }).click();
  expect((await figure()).model).toBeUndefined();
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('combobox', { name: 'Character' }).click();
  await page.getByRole('option', { name: 'Hero' }).click();
  f = await figure();
  expect(f.model).toBe(f.models[0].id);
});

test('the timeline zooms, retimes a stretch, plays slower and folds away', async ({ page }) => {
  // Keys every half second.
  await animate(page);
  await (await outline(page, 'Cast')).getByRole('button', { name: /^Figure/ }).first().click();
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 12; i++) await page.keyboard.press('.');
    await page.keyboard.press('k');
  }
  const keys = () => live(page).then(({ scene }) => keyTimesOf(scene.animation!, scene.figures[0].id).map((t) => Math.round(t * 1000) / 1000));
  // Zoom in about the playhead, then back to the whole animation.
  await page.getByRole('button', { name: /^Zoom in/ }).click();
  await expect(page.getByRole('button', { name: 'Fit the whole animation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Fit the whole animation' }).click();
  await expect(page.getByRole('button', { name: 'Fit the whole animation' })).toBeDisabled();

  // Shift-drag a key: it and the keys after it move together; the earlier ones stay.
  const before = await keys();
  const key = page.getByRole('button', { name: new RegExp(`^Key at ${before[2].toFixed(2)} s`) });
  const box = (await key.boundingBox())!;
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const duration = (await anim(page)).animation!.duration;
  const dx = (0.25 / shownTime(duration)) * lanes.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + (dx * i) / 6, box.y + box.height / 2);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const after = await keys();
  expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
  const moved = after[2] - before[2];
  expect(moved).toBeGreaterThan(0.1);
  expect(after.at(-1)! - before.at(-1)!).toBeCloseTo(moved, 2);

  // Slower playback, and repeating the shot.
  await page.getByRole('button', { name: 'Playback speed' }).click();
  await page.getByRole('menuitemradio', { name: /^0\.5×/ }).click();
  await expect(page.getByRole('button', { name: 'Playback speed' })).toHaveText('0.5×');
  await page.getByRole('button', { name: 'Animation options' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Repeat this shot' }).click();
  await page.getByRole('button', { name: 'Animation options' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Repeat this shot' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // Folded down to its toolbar (remembered).
  await page.getByRole('button', { name: 'Fold the timeline' }).click();
  await expect(page.locator('.tl-lanes')).toHaveCount(0);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByRole('button', { name: 'Show the tracks' })).toBeVisible();
  await page.getByRole('button', { name: 'Show the tracks' }).click();
  await expect(page.locator('.tl-lanes')).toBeVisible();
});

test('a wave over a walk, from the waist up; posing over a motion corrects it', async ({ page }) => {
  // (To one side behind: not a spot the figure stands in front of on screen.)
  await floorMenu(page, [1.2, 0, -3], 'Walk here');
  // Back to the middle of the walk.
  await page.getByRole('button', { name: 'Previous key' }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press('.');
  await expect(page.getByRole('status').filter({ hasText: /^Posing here corrects Figure's walk$/ })).toBeVisible();
  await openSection(page, 'Library');
  await libraryShows(page, 'Motions');
  await page.getByRole('button', { name: /^Wave hello: upper body only/ }).click();
  await expect(page.locator('.tl-travel.upper')).toHaveText(/Wave hello · upper body/);
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('.');
  await expect(page.getByRole('status').filter({ hasText: /Wave hello \(upper body\)$/ })).toBeVisible();
  const s = await live(page);
  expect(actionsOf(s.scene.animation!, s.active, 'upper')).toHaveLength(1);
});
