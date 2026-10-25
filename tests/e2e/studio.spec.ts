import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Hook = {
  store: {
    getState(): {
      library: { scenes: { id: string; name: string; figures: { id: string; joints: Record<string, number[]>; body: { sex: number }; hands: Record<string, { curl: number[] }> }[]; props: unknown[] }[] };
      sceneIndex: number;
      activeFigure: string;
      selection: unknown;
    };
  };
  viewport: { current: { project(figure: string, joint: string): { x: number; y: number } | null } | null };
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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  await page.mouse.up();
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

async function addLayer(page: Page, what: string) {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.getByRole('menuitem', { name: what, exact: true }).click();
}

async function deleteCurrentPose(page: Page) {
  await page.getByRole('button', { name: 'Pose actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
}

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.stage canvas').waitFor();
  await expect(page.locator('.thumbs img')).toHaveCount(20);
  await page.waitForTimeout(800); // first frames + framing
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('loads the 20 reference poses', async ({ page }) => {
  await expect(page.locator('.count')).toHaveText('20');
  await expect(page.locator('.scene-name')).toHaveValue('Hand on head');
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
  await page.keyboard.press('Control+z');
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

test('figures, props, body and hand presets', async ({ page }) => {
  await addLayer(page, 'Figure');
  await addLayer(page, 'Chair');
  let s = (await state(page)).scene;
  expect(s.figures).toHaveLength(2);
  expect(s.props).toHaveLength(1);

  await page.getByRole('tab', { name: 'Body' }).click();
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  s = (await state(page)).scene;
  expect(s.figures[1].body.sex).toBe(0);
  expect(s.figures[0].body.sex).toBe(1);

  await page.getByRole('tab', { name: 'Pose' }).click();
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

test('exports a 2400×3200 Pose.jpg sheet', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await expect(page.getByText('2400 × 3200 px')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('Pose.jpg');
  const size = jpegSize(readFileSync((await download.path())!));
  expect(size).toEqual({ width: 2400, height: 3200 });
});

test('share links open as a new pose', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.thumbs li').nth(4).locator('button').click();
  await page.getByRole('button', { name: /Share/ }).click();
  await expect(page.getByText('Share link copied')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#scene=');
  await page.goto(url);
  await page.reload();
  await expect(page.getByText(/Opened shared pose/)).toBeVisible();
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
  await page.getByRole('menuitem', { name: 'Import poses…' }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByText('Loaded 20 poses')).toBeVisible();
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
  await page.getByRole('button', { name: /Pose from photo/ }).click();
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
  await expect(page.locator('.library')).not.toBeInViewport();
  await page.getByRole('button', { name: 'Poses', exact: true }).click();
  await expect(page.locator('.library')).toBeInViewport();
  await page.locator('.thumbs li').nth(2).locator('button').click();
  await expect(page.locator('.library')).not.toBeInViewport();
  expect((await state(page)).sceneIndex).toBe(2);
});

test('exports a turnaround of the current pose', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByRole('radio', { name: 'Turnaround', exact: true }).click();
  await page.getByRole('combobox', { name: 'Style' }).selectOption('silhouette');
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

test('library keyboard navigation and reordering', async ({ page }) => {
  const first = page.locator('.thumbs button.thumb').first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.thumbs button.thumb').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Alt+ArrowDown');
  const s = await state(page);
  // "Hand on head" (the open pose) moved two places down and stays open.
  expect(s.library.scenes[2].name).toBe('Hand on head');
  expect(s.sceneIndex).toBe(2);
  await expect(page.locator('.thumbs button.thumb').nth(2)).toBeFocused();
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
  const other = await context.newPage();
  await other.goto('/');
  await other.locator('.stage canvas').waitFor();
  await deleteCurrentPose(other);
  await expect(other.locator('.save-status')).toHaveText('Saved');
  await expect(page.getByText('Your poses were updated in another tab')).toBeVisible();
  expect((await state(page)).library.scenes).toHaveLength(19);
  await other.close();
});

test('render styles switch from the toolbar and the Render tab', async ({ page }) => {
  await page.getByRole('button', { name: 'Render style' }).click();
  await page.getByRole('menuitemradio', { name: 'Ink wash' }).click();
  expect((await state(page) as unknown as { settings: { style: string } }).settings.style).toBe('ink');
  await page.getByRole('tab', { name: 'Render' }).click();
  await page.getByRole('radio', { name: 'Anime' }).click();
  expect((await state(page) as unknown as { settings: { style: string } }).settings.style).toBe('anime');
  await expect(page.locator('.style-card.on img')).toBeVisible();
  // L cycles through every style.
  await page.locator('.stage canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('l');
  expect((await state(page) as unknown as { settings: { style: string } }).settings.style).toBe('shaded');
});

test('male and female presets change the body', async ({ page }) => {
  await page.getByRole('tab', { name: 'Body' }).click();
  await page.getByRole('radio', { name: 'Male', exact: true }).click();
  expect((await state(page)).scene.figures[0].body.sex).toBe(0);
  await page.getByRole('radio', { name: 'Female', exact: true }).click();
  expect((await state(page)).scene.figures[0].body.sex).toBe(1);
});
