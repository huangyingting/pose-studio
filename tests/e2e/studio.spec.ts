import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { builtInPoses, poseScene } from '../../lib/poses';
import { CMU, bvh } from '../fixtures/bvh';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));

type Hook = {
  store: {
    getState(): {
      library: { scenes: { id: string; name: string; figures: { id: string; name: string; joints: Record<string, number[]>; body: { sex: number }; hands: Record<string, { curl: number[] }> }[]; props: unknown[] }[] };
      sceneIndex: number;
      activeFigure: string;
      selection: unknown;
    };
  };
  viewport: { current: { project(figure: string, joint: string): { x: number; y: number } | null; projectPoint(p: number[]): { x: number; y: number } } | null };
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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifier?: 'Shift') {
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

/** Open a section of the left side panel (clicking the open one would fold it away). */
async function openSection(page: Page, name: 'Scene' | 'Library') {
  const tab = page.getByRole('tab', { name, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

/** Add to the open scene's cast (Figure, Stand-in…) or set (props), from the Scene outline. */
async function addLayer(page: Page, what: string) {
  await openSection(page, 'Scene');
  const cast = what === 'Figure' || what.startsWith('Stand-in');
  await page.getByRole('button', { name: cast ? 'Add to cast' : 'Add to set' }).click();
  await page.getByRole('menuitem', { name: what, exact: !what.startsWith('Stand-in') }).click();
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
  await page.getByRole('radio', { name: 'Motions' }).click();
  await page.getByRole('list', { name: 'Motions' }).getByRole('button', { name: new RegExp(`^${motion}`) }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
}

/** A scene from a several-people motion in the library (opens as a new scene). */
async function motionScene(page: Page, motion: string) {
  await openSection(page, 'Library');
  await page.getByRole('radio', { name: 'Motions' }).click();
  await page.getByRole('list', { name: 'Motions' }).getByRole('button', { name: new RegExp(`^${motion}`) }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
}

// The tests work in a project of the 20 reference scenes (a new project has one blank scene).
const SEEDED = JSON.stringify({ version: 2, scenes: refScenes() });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate((lib) => {
    localStorage.clear();
    localStorage.setItem('pose-studio-library', lib);
    localStorage.setItem('pose-studio-settings', JSON.stringify({ tips: false }));
  }, SEEDED);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByLabel('Scene name')).toHaveValue('Hand on head');
  await page.waitForTimeout(800); // first frames + framing
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('a new project is one blank scene; the 20 reference poses are in the library', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByLabel('Scene name')).toHaveValue('Scene 1');
  await expect(page.getByRole('list', { name: 'Cast' }).getByRole('button', { name: 'Figure', exact: true })).toBeVisible();
  // A new user sees the core gestures once.
  const tips = page.getByRole('region', { name: 'Tips' });
  await expect(tips).toBeVisible();
  await tips.getByRole('button', { name: 'Got it' }).click();
  await expect(tips).toHaveCount(0);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(tips).toHaveCount(0);
  await openSection(page, 'Library');
  const poses = page.getByRole('list', { name: 'Poses' });
  await expect(poses.locator('img')).toHaveCount(20);
  await poses.getByRole('button', { name: /Hand on head/ }).click();
  await expect(page.getByText('Figure: Hand on head')).toBeVisible();
  expect((await state(page)).scene.figures[0].joints.shoulderR).toEqual(refScenes()[0].figures[0].joints.shoulderR);
});

test('things have names and right-click menus; Del, Ctrl+D and F2 act on the selection', async ({ page }) => {
  // Right-click empty floor: add a prop there.
  const canvas = (await page.locator('.stage canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width * 0.85, canvas.y + canvas.height * 0.85, { button: 'right' });
  await page.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name: 'Chair', exact: true }).click();
  await openSection(page, 'Scene');
  const set = page.getByRole('list', { name: 'Set' });

  // Double-click renames in place; the inspector's title shows the name.
  await set.getByRole('button', { name: 'Chair', exact: true }).dblclick();
  await page.getByRole('textbox', { name: 'Rename Chair' }).fill('Bar stool');
  await page.keyboard.press('Enter');
  await expect(set.getByRole('button', { name: 'Bar stool', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Chair name' })).toHaveValue('Bar stool');
  // Escape cancels a rename.
  await set.getByRole('button', { name: 'Bar stool', exact: true }).dblclick();
  await page.getByRole('textbox', { name: 'Rename Bar stool' }).fill('Oops');
  await page.keyboard.press('Escape');
  await expect(set.getByRole('button', { name: 'Bar stool', exact: true })).toBeVisible();

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
  await set.getByRole('button', { name: 'Bar stool', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(set.getByRole('button', { name: 'Bar stool 2', exact: true })).toBeVisible();

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
  await expect(tip).toContainText('Export image');
  await expect(tip.locator('kbd')).toHaveText('Ctrl E');
  const box = (await tip.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.mouse.move(600, 400);
  await expect(tip).toHaveCount(0);
});

test('clicking a body part selects it and the sliders edit it', async ({ page }) => {
  const p = await project(page, 'kneeL');
  const hip = await project(page, 'hipL');
  await page.mouse.click((p.x + hip.x) / 2, (p.y + hip.y) / 2);
  await expect(page.locator('.panel h3').first()).toHaveText('Left thigh');

  const before = (await state(page)).scene.figures[0].joints.hipL;
  const slider = page.locator('.slider input').first();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const after = (await state(page)).scene.figures[0].joints.hipL;
  expect(after[0]).toBe(before[0] - 2);

  await page.keyboard.press('Escape');
  // Two quick steps merge into one undo step; on a slow machine they may be two.
  await page.keyboard.press('Control+z');
  if ((await state(page)).scene.figures[0].joints.hipL[0] !== before[0]) await page.keyboard.press('Control+z');
  expect((await state(page)).scene.figures[0].joints.hipL).toEqual(before);
});

test('dragging a hand moves the arm with IK', async ({ page }) => {
  const wrist = await project(page, 'wristR');
  const target = { x: wrist.x - 90, y: wrist.y - 110 };
  await drag(page, wrist, target);
  const now = await project(page, 'wristR');
  expect(Math.hypot(now.x - target.x, now.y - target.y)).toBeLessThan(12);
});

test('dragging the hips down bends the knees and keeps the feet planted', async ({ page }) => {
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const ankle = await project(page, 'ankleL');
  const root = await project(page, 'root');
  await drag(page, root, { x: root.x, y: root.y + 70 });
  await page.waitForTimeout(200);
  const ankleAfter = await project(page, 'ankleL');
  expect(Math.hypot(ankleAfter.x - ankle.x, ankleAfter.y - ankle.y)).toBeLessThan(6);
  expect((await state(page)).scene.figures[0].joints.kneeL[0]).toBeGreaterThan(30);
});

test('figures and props move by dragging them and turn by their floor ring', async ({ page }) => {
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  type Placed = { position: number[]; rotation: number[]; joints: Record<string, number[]> };
  const figure = async () => (await state(page)).scene.figures[0] as unknown as Placed;
  const before = await figure();

  // Drag the torso: the figure moves on the floor, its pose unchanged.
  const chest = await project(page, 'chest');
  await drag(page, { x: chest.x, y: chest.y - 20 }, { x: chest.x + 100, y: chest.y - 20 });
  let f = await figure();
  expect(f.position[0]).toBeGreaterThan(before.position[0] + 0.1);
  expect(f.joints.shoulderR).toEqual(before.joints.shoulderR);
  expect((await state(page)).selection).toMatchObject({ kind: 'figure' });

  // Drag its floor ring around a quarter turn, with Shift: whole 15° steps.
  const [x, , z] = f.position;
  await drag(page, await projectPoint(page, [x, 0, z + 0.3]), await projectPoint(page, [x + 0.3, 0, z]), 'Shift');
  f = await figure();
  expect(f.joints.root[1] % 15).toBe(0);
  expect(f.joints.root[1]).not.toBe(before.joints.root?.[1] ?? 0);

  // A prop moves the same way; one undo step per drag.
  await addLayer(page, 'Box');
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

test('Shift-drag twists a part; handheld props go in the hand; the scene exports as a 3D model', async ({ page }) => {
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  type Posed = { joints: Record<string, number[] | undefined>; hands: Record<string, { curl: number[] }> };
  const figure = async () => (await state(page)).scene.figures[0] as unknown as Posed;
  const before = await figure();

  // Shift-drag the head sideways: it turns on its neck, the neck stays.
  const head = await project(page, 'head');
  await drag(page, { x: head.x, y: head.y - 20 }, { x: head.x + 80, y: head.y - 20 }, 'Shift');
  const after = await figure();
  expect(after.joints.head).not.toEqual(before.joints.head);
  expect(after.joints.neck).toEqual(before.joints.neck);

  // A phone goes into the selected figure's hand, which grips it.
  await page.getByRole('list', { name: 'Cast' }).getByRole('button').first().click();
  await addLayer(page, 'Phone');
  const prop = (await state(page)).scene.props[0] as unknown as { hold?: { hand: string } };
  expect(prop.hold?.hand).toBe('R');
  expect((await figure()).hands.R.curl[1]).toBeGreaterThan(0.4);
  await expect(page.getByRole('combobox', { name: 'Held by' })).toContainText('right hand');
  // Let go: it lands on the floor.
  await page.getByRole('button', { name: 'Let go' }).click();
  expect(((await state(page)).scene.props[0] as unknown as { hold?: unknown; position: number[] }).hold).toBeUndefined();

  // The posed scene as a binary glTF file.
  await page.keyboard.press('Control+e');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '3D model (.glb)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  expect(readFileSync((await download.path())!).subarray(0, 4).toString()).toBe('glTF');
});

test('figures, props, body and hand presets', async ({ page }) => {
  await addLayer(page, 'Figure');
  await addLayer(page, 'Chair');
  let s = (await state(page)).scene;
  expect(s.figures).toHaveLength(2);
  expect(s.props).toHaveLength(1);

  // The chair is selected: pick the new figure again, then its body.
  await page.getByRole('list', { name: 'Cast' }).getByRole('button', { name: 'Figure 2', exact: true }).click();
  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  s = (await state(page)).scene;
  expect(s.figures[1].body.sex).toBe(0);
  expect(s.figures[0].body.sex).toBe(1);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Hands', exact: true }).click();
  await page.getByRole('button', { name: 'Fist' }).click();
  s = (await state(page)).scene;
  expect(s.figures[1].hands.L.curl[1]).toBe(1);

  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  s = (await state(page)).scene;
  expect(s.figures).toHaveLength(1);
  expect(s.props).toHaveLength(0);
});

test('exports the pose library as a 2400×3200 Pose.jpg sheet', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Poses 20' }).click();
  await expect(page.getByText('2400 × 3200 px')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('Pose.jpg');
  const size = jpegSize(readFileSync((await download.path())!));
  expect(size).toEqual({ width: 2400, height: 3200 });
});

test('share links open as a new scene', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await (await openScenes(page)).locator('.thumbs li').nth(4).locator('button').click();
  await page.getByRole('button', { name: 'Main menu' }).click();
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
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Save library (.json)' }).click()]);
  const path = (await download.path())!;
  await page.getByRole('button', { name: 'Main menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Import scenes…' }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByText('Loaded 20 scenes')).toBeVisible();
  expect((await state(page)).library.scenes).toHaveLength(40);
});

test('keyboard shortcuts navigate, mirror and undo', async ({ page }) => {
  await page.keyboard.press(']');
  expect((await state(page)).sceneIndex).toBe(1);
  await page.keyboard.press('[');
  const before = (await state(page)).scene.figures[0].joints;
  await page.keyboard.press('m');
  const mirrored = (await state(page)).scene.figures[0].joints;
  expect(mirrored.shoulderR).toEqual([before.shoulderL[0], -before.shoulderL[1], -before.shoulderL[2]]);
  await page.keyboard.press('Control+z');
  expect((await state(page)).scene.figures[0].joints).toEqual(before);
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
  // The fixture is a lunge with arms pushing forward.
  expect(s.scene.figures[0].joints.kneeL?.[0] ?? 0).toBeGreaterThan(20);
  await expect(page.locator('img.reference')).toBeVisible();
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
});

test('exports a turnaround of the current pose', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Turnaround', exact: true }).click();
  await choose(page, 'Style', 'Silhouette');
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
  await page.getByRole('button', { name: 'Joints' }).click();
  await page.getByRole('button', { name: 'Left thigh', exact: true }).click();
  await page.getByRole('button', { name: /^Swing \(− forward\): .*Click to type a value$/ }).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('-42.5');
  await page.keyboard.press('Enter');
  expect((await state(page)).scene.figures[0].joints.hipL?.[0]).toBe(-42.5);
  // Out-of-range values are clamped to the joint limits.
  await page.getByRole('button', { name: /^Swing \(− forward\): .*Click to type a value$/ }).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('400');
  await page.keyboard.press('Enter');
  expect((await state(page)).scene.figures[0].joints.hipL?.[0]).toBe(50);
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
    (window as unknown as { __poseStudio: Hook }).__poseStudio.store.getState().library.scenes[0].figures[1].id, 'root',
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

test('render styles switch from the toolbar; the scene inspector shows the look', async ({ page }) => {
  await page.getByRole('button', { name: 'Render style' }).click();
  await page.getByRole('menuitemradio', { name: 'Ink wash' }).click();
  expect((await state(page) as unknown as { settings: { style: string } }).settings.style).toBe('ink');
  await page.getByRole('button', { name: 'Render style' }).click();
  await page.getByRole('menuitemradio', { name: 'Anime' }).click();
  expect((await state(page) as unknown as { settings: { style: string } }).settings.style).toBe('anime');
  // The scene (the crumb in the inspector's header): its light and look.
  await page.locator('.crumb').click();
  await expect(page.getByRole('group', { name: 'Lighting presets' })).toBeVisible();
  await expect(page.getByText(/^Anime: /)).toBeVisible();
  // L cycles through every style.
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('l');
  expect((await state(page) as unknown as { settings: { style: string } }).settings.style).toBe('shaded');
});

test('male and female presets change the body', async ({ page }) => {
  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('radio', { name: 'Male', exact: true }).click();
  expect((await state(page)).scene.figures[0].body.sex).toBe(0);
  await page.getByRole('radio', { name: 'Female', exact: true }).click();
  expect((await state(page)).scene.figures[0].body.sex).toBe(1);
});

type Fig = { id: string; position: number[]; joints: Record<string, number[]> };
const figs = async (page: Page) => (await state(page)).scene.figures as unknown as Fig[];

test('multi-person set-ups and relation tools', async ({ page }) => {
  await openScenes(page);
  await page.getByRole('button', { name: 'New scene' }).click();
  await page.getByRole('menuitem', { name: 'Handshake' }).click();
  expect((await state(page)).scene.name).toBe('Handshake');
  let [a, b] = await figs(page);
  expect(Math.abs(a.joints.root[1] - b.joints.root[1])).toBeCloseTo(180, 0);

  await page.getByRole('button', { name: 'Back to back' }).click();
  [a, b] = await figs(page);
  expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeCloseTo(0.32, 2);
  expect(Math.abs(Math.abs(a.joints.root[1] - b.joints.root[1]) - 180)).toBeLessThan(0.5);

  await page.getByRole('button', { name: 'Face each other' }).click();
  await page.getByRole('slider', { name: 'Distance' }).fill('1.5');
  [a, b] = await figs(page);
  expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeCloseTo(1.5, 1);

  // Too far apart to touch: the app says so.
  await choose(page, 'Touch', /Left shoulder$/);
  await page.getByRole('button', { name: 'Reach' }).click();
  await expect(page.getByText('Out of reach')).toBeVisible();
  await page.getByRole('slider', { name: 'Distance' }).fill('0.6');
  const before = (await figs(page))[0].joints.shoulderR;
  await page.getByRole('button', { name: 'Reach' }).click();
  expect((await figs(page))[0].joints.shoulderR).not.toEqual(before);

  await page.getByRole('button', { name: 'Look at' }).click();
  expect((await figs(page))[0].joints.head).toBeTruthy();
});

test('placement fields move and turn the figure, and faces can be hidden', async ({ page }) => {
  const x = page.getByRole('textbox', { name: 'Position X' });
  await x.fill('0.5');
  await x.press('Enter');
  const facingField = page.getByRole('textbox', { name: 'Facing' });
  await facingField.fill('90');
  await facingField.press('Enter');
  const [f] = await figs(page);
  expect(f.position[0]).toBe(0.5);
  expect(f.joints.root[1]).toBe(90);

  await page.locator('.crumb').click();
  await page.getByRole('switch', { name: 'Simple face features' }).uncheck();
  expect(((await state(page)) as unknown as { settings: { faces: boolean } }).settings.faces).toBe(false);
});

type Anim = { duration: number; keys: { t: number }[]; camera?: { keys: unknown[] } };
const anim = async (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __poseStudio: { store: { getState(): { time: number; sceneIndex: number; library: { scenes: { animation?: unknown }[] } } } } }).__poseStudio.store.getState();
  return { time: s.time, animation: s.library.scenes[s.sceneIndex].animation as Anim | undefined };
});

test('a library motion plays, takes keys and is filmed by a shot camera', async ({ page }) => {
  await sceneWithMotion(page, 'Dance groove');
  // Four keys of the loop, and the first again to close it.
  expect((await anim(page)).animation!.keys).toHaveLength(5);

  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Pause' }).click();
  expect((await anim(page)).time).toBeGreaterThan(0);

  // Step to a frame between keys and add a key there.
  await page.getByRole('button', { name: 'Previous keyframe' }).click();
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await page.keyboard.press('k');
  expect((await anim(page)).animation!.keys).toHaveLength(6);

  await page.getByRole('button', { name: 'Look through the shot camera' }).click();
  await expect(page.locator('.letterbox')).toBeVisible();
  // The shot's camera move: from its inspector to the library's camera moves.
  await openSection(page, 'Scene');
  await page.getByRole('list', { name: 'Shots' }).getByRole('button', { name: /Shot 1/ }).click();
  await page.getByRole('button', { name: 'Choose a camera move…' }).click();
  await page.getByRole('list', { name: 'Camera moves' }).getByRole('button', { name: 'Orbit 360°' }).click();
  expect((await anim(page)).animation!.camera!.keys).toHaveLength(4);
});

test('a still scene can be animated with auto-keys', async ({ page }) => {
  await page.getByRole('button', { name: 'Animate' }).first().click();
  for (let i = 0; i < 12; i++) await page.keyboard.press('.');
  expect((await anim(page)).time).toBeCloseTo(0.5, 2);
  await page.getByRole('button', { name: 'Joints' }).click();
  await page.getByRole('button', { name: 'Left thigh', exact: true }).click();
  const slider = page.locator('.slider input').first();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await anim(page)).animation!.keys.map((k) => k.t)).toEqual([0, 0.5]);
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
  await page.getByRole('radio', { name: 'Video' }).click();
  await expect(page.getByText(/1280 × 720 px · 1\.2 s at 24 fps/)).toBeVisible();
  await choose(page, 'Size', '1080 × 1080 (1:1)');
  [download] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), page.getByRole('button', { name: 'Record video' }).click()]);
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
  await page.getByRole('list', { name: 'Shots' }).getByRole('button', { name: /Shot 2/ }).click();
  await page.getByRole('textbox', { name: 'Shot caption' }).fill('She waves back');
  // Shortcuts are off while typing.
  await page.getByRole('textbox', { name: 'Shot caption' }).blur();

  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Keyframe pack' }).click();
  await page.getByRole('switch', { name: 'Greybox clip of each shot' }).uncheck();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 200_000 }), page.getByRole('button', { name: 'Download pack' }).click()]);
  expect(download.suggestedFilename()).toBe('Wave_hello_keyframes.zip');
  const zip = readFileSync((await download.path())!);
  const text = zip.toString('latin1');
  for (const name of ['cutlist.otio', '01_Shot_1/first_depth.png', '02_Shot_2/last_normal.png', '02_Shot_2/camera.json']) expect(text).toContain(name);
  expect(text).toContain('she waves back');
});

test('storyboard: panels with captions, reordering, board sheet export and persistence', async ({ page }) => {
  test.setTimeout(120_000);
  await page.keyboard.press('b');
  const board = page.getByRole('dialog', { name: 'Storyboard' });
  await expect(board.getByText('Tell a story, one panel at a time')).toBeVisible();
  await board.getByRole('button', { name: /^Add “/ }).first().click();
  await board.getByRole('button', { name: 'Close storyboard' }).click();

  // A second scene, added from the scene picker's actions.
  await (await openScenes(page)).locator('.thumbs li').nth(3).click();
  const second = (await state(page)).scene.name;
  await openScenes(page);
  await page.getByRole('button', { name: 'Scene actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to storyboard' }).click();
  await closeScenes(page);
  await page.keyboard.press('b');
  await expect(board.locator('.panel-card')).toHaveCount(2);
  await expect(board.getByText('2 panels · 4.0 s')).toBeVisible();
  await board.getByRole('textbox', { name: 'Panel 2 caption' }).fill('A sudden turn');

  await board.locator('.panel-card').nth(1).dragTo(board.locator('.panel-card').nth(0));
  await expect(board.locator('.panel-name').first()).toHaveText(second);
  await expect(board.getByRole('textbox', { name: 'Panel 1 caption' })).toHaveValue('A sudden turn');

  await board.getByRole('button', { name: 'Export storyboard' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Board sheet (PNG)' }).click()]);
  expect(download.suggestedFilename()).toBe('Storyboard.png');
  const png = readFileSync((await download.path())!);
  expect(png.readUInt32BE(16)).toBeGreaterThan(1000);

  await page.keyboard.press('Escape');
  await expect(board).toBeHidden();
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await page.keyboard.press('b');
  await expect(board.getByRole('textbox', { name: 'Panel 1 caption' })).toHaveValue('A sudden turn');
});

test('motion check flags foot sliding and jumps to it', async ({ page }) => {
  test.setTimeout(120_000);
  await sceneWithMotion(page, 'Walk ahead');
  await page.locator('.tl-qa').click();
  await expect(page.locator('.tl-qa')).toHaveText('No issues', { timeout: 30_000 });

  // Gliding the same 3 m instead of walking: the feet slide.
  const keys = (await anim(page)).animation!.keys.map((k) => k.t);
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const row = (await page.locator('[aria-label="Pose keyframes"]').boundingBox())!;
  const duration = (await anim(page)).animation!.duration;
  await page.mouse.click(lanes.x + (lanes.width * (keys[0] + keys[1])) / 2 / duration, row.y + row.height / 2, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Glide (as keyed)' }).click();
  await page.locator('.tl-qa').click();
  const card = page.getByRole('dialog', { name: 'Motion check' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tl-issue').first()).toBeVisible();
  await card.locator('li button').filter({ hasText: /foot slides/ }).first().click();
  const s = await state(page);
  expect((s as unknown as { time: number }).time).toBeGreaterThan(0);
  expect(s.selection).toMatchObject({ kind: 'joint', joint: expect.stringMatching(/^ankle[LR]$/) });
  // Editing the animation clears the results.
  await page.keyboard.press('k');
  await expect(page.locator('.tl-issue')).toHaveCount(0);
});

test('stand-ins block a scene in a posture and can become posable figures', async ({ page }) => {
  await addLayer(page, 'Stand-in');
  await expect(page.getByRole('button', { name: 'Stand-in', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Sit' }).click();
  let s = await state(page);
  const standIn = () => s.scene.figures.find((f) => f.id === s.activeFigure) as unknown as { proxy?: string; joints: Record<string, number[]> };
  expect(standIn().proxy).toBe('sit');
  expect(standIn().joints.kneeL[0]).toBeGreaterThan(80);
  // Not posed joint by joint: no IK handles, no joint panel.
  await expect(page.getByRole('button', { name: 'Joints' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Make it a posable figure' }).click();
  s = await state(page);
  expect(standIn().proxy).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Joints' })).toBeVisible();
});

async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('menuitem', { name: /Test account/ }).click();
  await expect(page.locator('.avatar')).toBeVisible({ timeout: 30_000 });
}

test('signing in syncs the library to the account (server edition)', async ({ page }) => {
  test.setTimeout(150_000);
  await page.getByRole('tab', { name: 'AI assistant' }).click();
  await expect(page.getByText('Sign in to pose, stage and animate')).toBeVisible();
  await signIn(page);
  const server = () => page.evaluate(() => fetch('/api/library').then((r) => r.json()) as Promise<{ version: number; library: { scenes: { name: string }[] } | null }>);
  await expect.poll(async () => (await server()).library?.scenes.length ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(20);
  // Edits follow a moment later.
  await page.getByLabel('Scene name').fill('Synced scene');
  await expect.poll(async () => (await server()).library?.scenes.map((s) => s.name), { timeout: 30_000 }).toContain('Synced scene');
  await page.locator('.avatar').click();
  await expect(page.getByRole('menuitem', { name: /Library synced/ })).toBeVisible();
});

test('the AI assistant runs on the server and its tools on the open pose', async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page);
  await page.getByRole('tab', { name: 'AI assistant' }).click();
  await page.getByLabel('Message the assistant').fill('Anime style please');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Switched to anime/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.assistant-tool code')).toHaveText('set_style');
  expect(await page.evaluate(() => (window as unknown as { __poseStudio: { store: { getState(): { settings: { style: string } } } } }).__poseStudio.store.getState().settings.style)).toBe('anime');
  await expect(page.locator('.assistant-usage')).toContainText('/ 1000');
});

test('each figure has its own key track', async ({ page }) => {
  await motionScene(page, 'Boxing exchange');
  await expect(page.getByRole('button', { name: /^Kai key at 0.83 s/ })).toBeVisible();
  await page.locator('.tl-figure', { hasText: 'Kai' }).click();
  await expect(page.locator('.tl-figure.on')).toHaveText('Kai');
  // Delete Kai's key at 0.83 s: Ben's stays.
  await page.getByRole('button', { name: /^Kai key at 0.83 s/ }).click();
  await page.getByRole('button', { name: 'Delete keyframe (Kai)' }).click();
  await expect(page.getByRole('button', { name: /^Kai key at 0.83 s/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Ben key at 0.83 s/ })).toBeVisible();
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

test('the side panel switches sections, folds away and remembers it', async ({ page }) => {
  await openSection(page, 'Library');
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Library' })).toBeVisible();
  await openSection(page, 'Scene');
  await page.getByRole('tabpanel').getByRole('button', { name: 'Animate' }).click();
  await expect(page.getByRole('list', { name: 'Shots' })).toBeVisible();
  // Clicking the open section folds the panel; the canvas gets the room.
  const before = (await page.locator('.stage').boundingBox())!.width;
  await page.getByRole('tab', { name: 'Scene', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  expect((await page.locator('.stage').boundingBox())!.width).toBeGreaterThan(before + 200);
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await openSection(page, 'Scene');
  await expect(page.getByRole('list', { name: 'Cast' })).toBeVisible();
});

test('library assets apply to the selection: poses to a figure, motions to its track, saved poses', async ({ page }) => {
  await addLayer(page, 'Figure');
  const [, second] = await figs(page);
  await openSection(page, 'Library');
  await page.getByRole('list', { name: 'Poses' }).getByRole('button', { name: /Cobra/ }).click();
  const [a, b] = await figs(page);
  // The selected (new) figure took the pose where it stands; the first one did not change.
  expect(b.id).toBe(second.id);
  expect(b.joints).toMatchObject({ root: [refScenes()[10].figures[0].joints.root![0], 0, refScenes()[10].figures[0].joints.root![2]] });
  expect(a.joints).toEqual(refScenes()[0].figures[0].joints);
  // Save it, then a motion goes on this figure's track only.
  await page.getByRole('button', { name: /Save Figure 2's pose/ }).click();
  await expect(page.getByRole('list', { name: 'Poses' }).locator('li')).toHaveCount(21);
  await page.getByRole('radio', { name: 'Motions' }).click();
  await page.getByRole('list', { name: 'Motions' }).getByRole('button', { name: /^Jump/ }).click();
  const tracks = await page.evaluate(() => {
    const st = (window as unknown as { __poseStudio: { store: { getState(): { sceneIndex: number; library: { scenes: { figures: { id: string }[]; animation?: { keys: { poses: Record<string, unknown> }[] } }[] } } } } }).__poseStudio.store.getState();
    const sc = st.library.scenes[st.sceneIndex];
    return sc.figures.map((f) => sc.animation!.keys.filter((k) => k.poses[f.id]).length);
  });
  expect(tracks[0]).toBe(1);
  // Where it stands and where it lands; the jump in between is generated.
  expect(tracks[1]).toBe(2);
});

/** The live scene, as the tests below need it. */
type LiveScene = {
  figures: { id: string; name: string; color?: string; gaze?: { figure?: string } }[];
  props: { id: string; name: string; hold?: unknown }[];
  light?: { warmth: number; azimuth: number };
  animation?: {
    duration: number;
    shots?: { subject?: string }[];
    keys: { t: number; poses: Record<string, { travel?: string; spin?: number; position: number[] }>; props?: Record<string, { throw?: boolean; hold?: unknown }> }[];
  };
};
type LiveStore = { scene: LiveScene; getState(): { activeFigure: string; time: number; library: { motions?: { name: string }[] } } };
const live = (page: Page) =>
  page.evaluate(() => {
    const store = (window as unknown as { __poseStudio: { store: LiveStore } }).__poseStudio.store;
    return { scene: store.scene, active: store.getState().activeFigure, time: store.getState().time, motions: store.getState().library.motions ?? [] };
  });

/** Right-click a point on the floor and pick from its menu. */
async function floorMenu(page: Page, at: number[], item: string | RegExp) {
  const p = await projectPoint(page, at);
  const canvas = (await page.locator('.stage canvas').boundingBox())!;
  expect(p.y, 'the point is on screen').toBeLessThan(canvas.y + canvas.height - 10);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

test('figures walk, run and jump to marks from the floor menu; the timeline says how they get there', async ({ page }) => {
  await floorMenu(page, [0.8, 0, -1.2], 'Walk here');
  let s = await live(page);
  let track = s.scene.animation!.keys.filter((k) => k.poses[s.active]);
  expect(track).toHaveLength(2);
  expect(track[1].poses[s.active].travel).toBe('walk');
  expect(track[1].poses[s.active].position[0]).toBeCloseTo(0.8, 1);
  expect(track[1].poses[s.active].position[2]).toBeCloseTo(-1.2, 1);
  // The playhead waits at the new mark; the next one chains on.
  expect(s.time).toBeCloseTo(track[1].t, 1);
  await floorMenu(page, [-0.8, 0, -2.4], 'Run here');
  s = await live(page);
  track = s.scene.animation!.keys.filter((k) => k.poses[s.active]);
  expect(track.map((k) => k.poses[s.active].travel ?? null)).toEqual([null, 'walk', 'run']);

  // Right-click between the first two keys on the timeline: jump there instead, with a full turn.
  const box = (await page.locator('[aria-label="Pose keyframes"]').boundingBox())!;
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const x = lanes.x + (lanes.width * (track[0].t + track[1].t)) / 2 / s.scene.animation!.duration;
  await page.mouse.click(x, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Jump', exact: true }).click();
  await page.mouse.click(x, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Full turn' }).click();
  s = await live(page);
  const key = s.scene.animation!.keys.filter((k) => k.poses[s.active])[1].poses[s.active];
  expect(key.travel).toBe('jump');
  expect(key.spin).toBe(1);
});

test('a held prop is thrown to a spot on the floor, keyed over time', async ({ page }) => {
  await addLayer(page, 'Stick');
  let s = await live(page);
  expect(s.scene.props[0].hold).toBeTruthy();
  await page.getByRole('tabpanel').getByRole('button', { name: 'Animate' }).click();
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  for (let i = 0; i < 6; i++) await page.keyboard.press('.');
  await floorMenu(page, [1.2, 0, -1], /^Throw .* here$/);
  s = await live(page);
  const keys = s.scene.animation!.keys.filter((k) => k.props?.[s.scene.props[0].id]);
  expect(keys.some((k) => k.props![s.scene.props[0].id].throw)).toBe(true);
  await expect(page.locator('.tl-key.prop').first()).toBeVisible();
});

test('eyes on another figure, figure colours, a shot subject and the scene light', async ({ page }) => {
  await addLayer(page, 'Figure');
  let s = await live(page);
  const [first, second] = s.scene.figures;
  expect(s.active).toBe(second.id);
  await choose(page, 'Eyes on', first.name);
  s = await live(page);
  expect(s.scene.figures[1].gaze?.figure).toBe(first.id);

  await page.getByRole('button', { name: 'Body & colour' }).click();
  await page.getByRole('radiogroup', { name: 'Colour' }).getByRole('radio').nth(1).click();
  s = await live(page);
  expect(s.scene.figures[1].color).toMatch(/^#/);

  // A shot that follows one figure.
  await openSection(page, 'Scene');
  await page.getByRole('tabpanel').getByRole('button', { name: 'Animate' }).click();
  await page.locator('.tl-shot').first().click();
  await choose(page, 'Shot subject', second.name);
  s = await live(page);
  expect(s.scene.animation!.shots?.[0]?.subject).toBe(second.id);

  // Dusk light, kept with the scene.
  await page.getByRole('button', { name: 'Render style' }).click();
  await page.getByRole('menuitemradio', { name: 'Clay' }).click();
  await page.locator('.crumb').click();
  await page.getByRole('group', { name: 'Lighting presets' }).getByRole('button', { name: 'Dusk' }).click();
  s = await live(page);
  expect(s.scene.light?.warmth).toBeGreaterThan(0.5);
});

test('a motion file is imported into My motions and given to the figure', async ({ page }) => {
  await openSection(page, 'Library');
  await page.getByRole('radio', { name: 'Motions' }).click();
  await page.getByLabel('Motion file').setInputFiles({ name: 'Step forward.bvh', mimeType: 'text/plain', buffer: Buffer.from(bvh(CMU)) });
  const mine = page.getByRole('list', { name: 'My motions' });
  await expect(mine.getByRole('button', { name: /^Step forward/ })).toBeVisible();
  expect((await live(page)).motions.map((m) => m.name)).toEqual(['Step forward']);
  await mine.getByRole('button', { name: /^Step forward/ }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  const s = await live(page);
  expect(s.scene.animation!.keys.filter((k) => k.poses[s.active]).length).toBeGreaterThan(2);
  // Deleting it takes it out of the library (the figure keeps its keys).
  await mine.getByRole('button', { name: 'Delete my motion Step forward' }).click();
  await expect(page.getByRole('list', { name: 'My motions' })).toHaveCount(0);
});
