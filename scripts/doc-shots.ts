// The user guide's screenshots (docs/guide/images/*.png): each a state of the running app, numbered
// marks drawn over what its page explains. Run with `npm run dev` going:
// `npm run doc-shots` (or `npm run doc-shots -- http://localhost:3000/ [shot name…]`).
import { mkdir } from 'node:fs/promises';
import { chromium, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';

const [url = 'http://localhost:3000/', ...only] = process.argv.slice(2);
const OUT = 'docs/guide/images';

type Box = { x: number; y: number; width: number; height: number };
/** A numbered mark: round what it points at (or only a badge, `ring: false`), its number on one side. */
type Mark = { n: number; at: Locator | Box | (() => Promise<Box>); side?: 'top' | 'bottom' | 'left' | 'right' | 'inside' | 'inside-bottom'; ring?: boolean };
type Shot = { name: string; size?: { width: number; height: number }; clip?: () => Promise<Box>; setup(page: Page): Promise<void>; marks?(page: Page): Mark[] };

type Hook = { store: { scene: { figures: { id: string }[]; cameras: { id: string }[] }; getState(): { activeFigure: string }; select(s: unknown): void; setTime(t: number): void }; viewport: { current: { project(figure: string, joint: string): { x: number; y: number } | null } } };

/** A box round a figure's joint as it is on the screen. */
const joint = (page: Page, part: string, r = 22, figure = 0) => async (): Promise<Box> => {
  const p = await page.evaluate(([part, figure]) => {
    const h = (window as unknown as { __poseStudio: Hook }).__poseStudio;
    return h.viewport.current.project(h.store.scene.figures[figure as number].id, part as string);
  }, [part, figure] as const);
  return { x: p!.x - r, y: p!.y - r, width: 2 * r, height: 2 * r };
};

/** The box of the first element matching `selector` with `text` that is in view (a zoomed timeline has others past its ends). */
const shown = (page: Page, selector: string, text: string) => async (): Promise<Box> => {
  const box = await page.evaluate(([selector, text]) => {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (el.textContent?.includes(text) && r.left >= 0 && r.right <= innerWidth) return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return null;
  }, [selector, text] as const);
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
};
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name, exact: true }).click();
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });
const canvas = (page: Page) => page.locator('.stage canvas');
const idle = (page: Page, ms = 900) => page.waitForTimeout(ms);

async function fresh(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await canvas(page).waitFor({ timeout: 180_000 });
  await idle(page, 2500);
}

/** A scene template opened as a new scene (its models and motions in). */
async function template(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: 'New scene…' }).click();
  await page.getByRole('dialog', { name: 'New scene' }).getByRole('button', { name }).first().click();
  await idle(page, 9000);
}

/** Select the scene's figure or camera by its place in the scene. */
async function select(page: Page, kind: 'figure' | 'camera', i: number) {
  await page.evaluate(([kind, i]) => {
    const h = (window as unknown as { __poseStudio: Hook }).__poseStudio;
    const scene = h.store.scene;
    h.store.select(kind === 'figure' ? { kind, figure: scene.figures[i].id } : { kind, camera: scene.cameras[i].id });
  }, [kind, i] as const);
  await idle(page);
}

async function drawMarks(page: Page, marks: Mark[]) {
  const boxes: { n: number; box: Box; side: string; ring: boolean }[] = [];
  for (const m of marks) {
    const box = typeof m.at === 'function' ? await m.at() : 'x' in m.at ? m.at : await m.at.first().boundingBox();
    if (box) boxes.push({ n: m.n, box, side: m.side ?? 'top', ring: m.ring ?? true });
  }
  await page.evaluate((boxes) => {
    const root = document.createElement('div');
    root.id = 'doc-marks';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const S = 26;
    for (const { n, box: b, side, ring } of boxes) {
      if (ring) {
        const r = document.createElement('div');
        r.style.cssText = `position:fixed;left:${b.x - 3}px;top:${b.y - 3}px;width:${b.width + 6}px;height:${b.height + 6}px;border:2.5px solid #e5484d;border-radius:8px;box-shadow:0 0 0 1.5px rgba(255,255,255,.9)`;
        root.appendChild(r);
      }
      const c = document.createElement('div');
      let x = b.x + b.width / 2 - S / 2;
      let y = b.y - S - 6;
      if (side === 'bottom') y = b.y + b.height + 6;
      if (side === 'left') { x = b.x - S - 6; y = b.y + b.height / 2 - S / 2; }
      if (side === 'right') { x = b.x + b.width + 6; y = b.y + b.height / 2 - S / 2; }
      if (side === 'inside') { x = b.x + 4; y = b.y + 4; }
      if (side === 'inside-bottom') y = b.y + b.height - S - 10;
      x = Math.max(2, Math.min(innerWidth - S - 2, x));
      y = Math.max(2, Math.min(innerHeight - S - 2, y));
      c.textContent = String(n);
      c.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${S}px;height:${S}px;border-radius:50%;background:#e5484d;color:#fff;font:700 14px/${S - 4}px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)`;
      root.appendChild(c);
    }
    document.body.appendChild(root);
  }, boxes);
}

const SHOTS: Shot[] = [
  {
    name: 'layout',
    async setup(page) {
      await template(page, /^Café meeting/);
      await select(page, 'figure', 0);
      await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.store.setTime(4));
      await idle(page, 1500);
    },
    marks: (page) => [
      { n: 1, at: page.getByRole('button', { name: 'Main menu' }), side: 'bottom' },
      { n: 2, at: page.locator('.topbar .toolbar').first(), side: 'bottom' },
      { n: 3, at: page.locator('.tb-center'), side: 'bottom' },
      { n: 4, at: page.locator('.tb-right'), side: 'bottom' },
      { n: 5, at: page.locator('.rail'), side: 'right' },
      { n: 6, at: page.locator('.side-panel'), side: 'inside-bottom', ring: false },
      { n: 7, at: page.locator('.canvas-tools'), side: 'right' },
      { n: 8, at: page.locator('.view-ball'), side: 'left' },
      { n: 9, at: inspector(page), side: 'inside-bottom', ring: false },
      { n: 10, at: timeline(page), side: 'inside', ring: false },
      { n: 11, at: page.locator('.stage-hint .bar-hint').first(), side: 'top' },
    ],
  },
  {
    name: 'posing',
    async setup(page) {
      await fresh(page);
      const h = await page.evaluate(() => { const x = (window as unknown as { __poseStudio: Hook }).__poseStudio; return x.viewport.current.project(x.store.scene.figures[0].id, 'rightHand'); });
      await page.mouse.move(h!.x, h!.y + 6);
      await page.mouse.down();
      await page.mouse.move(h!.x + 40, h!.y - 240, { steps: 14 });
      await page.mouse.up();
      await idle(page);
      const l = await page.evaluate(() => { const x = (window as unknown as { __poseStudio: Hook }).__poseStudio; return x.viewport.current.project(x.store.scene.figures[0].id, 'leftLowerArm'); });
      await page.mouse.click(l!.x, l!.y);
      await idle(page, 1200);
    },
    marks: (page) => [
      { n: 1, at: page.locator('.canvas-tools'), side: 'right' },
      { n: 2, at: joint(page, 'rightHand', 26), side: 'right' },
      { n: 3, at: joint(page, 'leftLowerArm', 60), side: 'right', ring: false },
      { n: 4, at: inspector(page).locator('.bodymap').first(), side: 'left' },
      { n: 5, at: inspector(page).locator('.slider').first(), side: 'left' },
      { n: 6, at: inspector(page).locator('.psec-head').first(), side: 'left' },
    ],
  },
  {
    name: 'pins',
    async setup(page) {
      await fresh(page);
      const f = await page.evaluate(() => { const x = (window as unknown as { __poseStudio: Hook }).__poseStudio; return x.viewport.current.project(x.store.scene.figures[0].id, 'leftFoot'); });
      await page.mouse.click(f!.x, f!.y, { button: 'right' });
      await idle(page, 600);
    },
    marks: (page) => [
      { n: 1, at: joint(page, 'leftFoot', 24), side: 'left' },
      { n: 2, at: page.getByRole('menuitemcheckbox', { name: 'Pinned' }), side: 'right' },
      { n: 3, at: page.getByRole('menuitem', { name: 'Reset the joint' }), side: 'right' },
    ],
  },
  {
    name: 'placing',
    async setup(page) {
      await fresh(page);
      await page.getByRole('button', { name: 'Add to cast' }).click();
      await page.getByRole('menuitem', { name: 'Figure', exact: true }).click();
      await page.mouse.move(930, 600, { steps: 6 });
      await idle(page, 1200);
    },
    marks: (page) => [
      { n: 1, at: page.getByRole('button', { name: 'Add to cast' }), side: 'right' },
      { n: 2, at: { x: 850, y: 190, width: 160, height: 430 }, side: 'right' },
      { n: 3, at: page.locator('.stage-hint .bar-hint').first(), side: 'top' },
    ],
  },
  {
    name: 'figure-inspector',
    clip: async () => ({ x: 1100, y: 48, width: 300, height: 832 }),
    async setup(page) {
      await template(page, /^Café meeting/);
      await select(page, 'figure', 0);
      for (const t of ['Joints', 'With others', 'Hands']) {
        const head = inspector(page).locator('.psec-title').filter({ has: page.locator('h3', { hasText: new RegExp(`^${t}$`) }) });
        if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
      }
      await idle(page);
    },
  },
  {
    name: 'library-poses',
    async setup(page) {
      await fresh(page);
      await tab(page, 'Poses');
      await idle(page, 8000);
      await page.locator('.lib-grid button.lib-tile').nth(5).hover();
      await idle(page, 2500);
    },
    marks: (page) => [
      { n: 1, at: page.locator('.rail'), side: 'right' },
      { n: 2, at: page.getByRole('searchbox').first(), side: 'bottom' },
      { n: 3, at: page.locator('.lib-grid button.lib-tile').nth(5), side: 'top' },
      { n: 4, at: page.locator('.lib-preview').first(), side: 'right' },
    ],
  },
  {
    name: 'library-motions',
    async setup(page) {
      await fresh(page);
      await tab(page, 'Motions');
      await page.getByLabel('Search motions').fill('wave');
      await page.getByRole('tabpanel').locator('.side-list-name').first().click();
      await idle(page, 1500);
    },
    marks: (page) => [
      { n: 1, at: page.getByLabel('Search motions'), side: 'right' },
      { n: 2, at: page.getByRole('tabpanel').locator('.side-list-name').first(), side: 'right' },
      { n: 3, at: timeline(page).locator('.tl-travel').first(), side: 'top' },
    ],
  },
  {
    name: 'sets-sit',
    async setup(page) {
      await fresh(page);
      await tab(page, 'Sets');
      await page.getByRole('tabpanel').getByRole('button', { name: /Living room/ }).first().click();
      await idle(page, 8000);
      await page.mouse.click(530, 470, { button: 'right' });
      await idle(page, 700);
    },
    marks: (page) => [
      { n: 1, at: page.locator('.lib-grid button.lib-tile.on').first(), side: 'right' },
      { n: 2, at: { x: 510, y: 450, width: 40, height: 40 }, side: 'left' },
      { n: 3, at: page.getByRole('menuitem', { name: 'Sit here' }), side: 'right' },
    ],
  },
  {
    name: 'new-scene',
    async setup(page) {
      await fresh(page);
      await page.getByRole('button', { name: 'Main menu' }).click();
      await page.getByRole('menuitem', { name: 'New scene…' }).click();
      // (Its thumbnails drawn one by one.)
      await idle(page, 30000);
    },
  },
  {
    name: 'timeline',
    async setup(page) {
      await template(page, /^Café meeting/);
      await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.store.setTime(8));
      for (let i = 0; i < 3; i++) await timeline(page).getByRole('button', { name: /Zoom in/ }).click();
      await idle(page, 1200);
    },
    marks: (page) => [
      { n: 1, at: timeline(page).getByRole('button', { name: 'Play', exact: true }), side: 'top' },
      { n: 2, at: timeline(page).locator('.tl-bar button', { has: page.locator('.tl-label', { hasText: /^Key$/ }) }), side: 'top' },
      { n: 3, at: timeline(page).getByRole('button', { name: /^Cut/ }).first(), side: 'top' },
      { n: 4, at: timeline(page).getByRole('button', { name: /Director|By hand|Conversation/ }).first(), side: 'top' },
      { n: 5, at: timeline(page).getByRole('button', { name: /^Check/ }).first(), side: 'top' },
      { n: 6, at: timeline(page).locator('.tl-shot', { hasText: 'Shot 5' }), side: 'top' },
      { n: 7, at: shown(page, '.tl-travel', 'Wave, both arms'), side: 'bottom' },
      { n: 8, at: timeline(page).locator('.tl-playhead').first(), side: 'top' },
    ],
  },
  {
    name: 'action-inspector',
    async setup(page) {
      await template(page, /^Café meeting/);
      const blk = timeline(page).locator('.tl-travel.clip').nth(2);
      await blk.click({ button: 'right' });
      await idle(page, 900);
    },
    marks: (page) => [
      { n: 1, at: timeline(page).locator('.tl-travel.clip').nth(2), side: 'top' },
      { n: 2, at: page.locator('.context-menu'), side: 'right' },
      { n: 3, at: inspector(page), side: 'inside-bottom', ring: false },
    ],
  },
  {
    name: 'walk-to',
    async setup(page) {
      await fresh(page);
      await page.mouse.click(980, 690, { button: 'right' });
      await idle(page, 700);
    },
    marks: (page) => [
      { n: 1, at: { x: 965, y: 675, width: 30, height: 30 }, side: 'left' },
      { n: 2, at: page.getByRole('menuitem', { name: 'Walk here' }), side: 'left' },
    ],
  },
  {
    name: 'walk-done',
    async setup(page) {
      await fresh(page);
      await page.mouse.click(980, 690, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Walk here' }).click();
      await idle(page, 1500);
      await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.store.setTime(0.6));
      await idle(page, 1500);
    },
    marks: (page) => [
      { n: 1, at: timeline(page).locator('.tl-travel').first(), side: 'top' },
    ],
  },
  {
    name: 'camera',
    async setup(page) {
      await template(page, /^Café meeting/);
      await select(page, 'camera', 1);
      await idle(page, 2500);
    },
    marks: (page) => [
      { n: 1, at: page.getByRole('list', { name: 'Cameras' }), side: 'right' },
      { n: 2, at: page.locator('.camera-pip'), side: 'left' },
      { n: 3, at: inspector(page).getByRole('button', { name: 'Look through this camera' }), side: 'left' },
      { n: 4, at: inspector(page), side: 'inside-bottom', ring: false },
    ],
  },
  {
    name: 'look-through',
    async setup(page) {
      await template(page, /^Café meeting/);
      await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.store.setTime(12));
      await select(page, 'camera', 1);
      await inspector(page).getByRole('button', { name: 'Look through this camera' }).click();
      await idle(page, 2500);
    },
    marks: (page) => [
      { n: 1, at: page.locator('.letterbox-banner'), side: 'bottom' },
      { n: 2, at: page.locator('.letterbox-sizes'), side: 'top' },
    ],
  },
  {
    name: 'director',
    async setup(page) {
      await template(page, /^Café meeting/);
      await timeline(page).getByRole('button', { name: /Director|By hand|Conversation/ }).first().click();
      await idle(page, 700);
    },
    marks: (page) => [
      { n: 1, at: timeline(page).getByRole('button', { name: /Director|By hand|Conversation/ }).first(), side: 'top' },
      { n: 2, at: page.getByRole('menu'), side: 'right' },
    ],
  },
  {
    name: 'lighting',
    async setup(page) {
      await template(page, /^Café meeting/);
      await page.getByRole('button', { name: 'Render style' }).click();
      await page.getByRole('menuitemradio', { name: /^Clay/ }).click();
      await idle(page, 2000);
      await page.getByRole('list', { name: 'Lights' }).getByRole('button', { name: /^Lighting/ }).first().click();
      await idle(page, 3000);
    },
    marks: (page) => [
      { n: 1, at: page.getByRole('list', { name: 'Lights' }), side: 'right' },
      { n: 2, at: inspector(page), side: 'inside-bottom', ring: false },
      { n: 3, at: page.getByRole('button', { name: 'Render style' }), side: 'bottom' },
    ],
  },
  {
    name: 'storyboard',
    async setup(page) {
      await template(page, /^Café meeting/);
      await canvas(page).click({ position: { x: 5, y: 300 } });
      await page.keyboard.press('b');
      // (Its panels drawn one by one.)
      await idle(page, 30000);
    },
  },
  {
    name: 'export',
    async setup(page) {
      await template(page, /^Café meeting/);
      await page.keyboard.press('Control+e');
      await idle(page, 3000);
    },
    marks: (page) => [
      { n: 1, at: page.locator('.export-outputs'), side: 'right' },
      { n: 2, at: page.getByRole('dialog', { name: 'Export' }).getByRole('textbox', { name: 'Width' }), side: 'left' },
      { n: 3, at: page.locator('.modal .preview, .export-preview').first(), side: 'inside', ring: false },
      { n: 4, at: page.getByRole('button', { name: 'Download' }), side: 'left' },
    ],
  },
  {
    name: 'palette',
    async setup(page) {
      await fresh(page);
      await page.keyboard.press('Control+k');
      await page.keyboard.type('walk');
      await idle(page, 900);
    },
  },
  {
    name: 'practice',
    async setup(page) {
      await fresh(page);
      await canvas(page).click({ position: { x: 5, y: 300 } });
      await page.keyboard.press('p');
      await idle(page, 900);
    },
  },
  {
    name: 'phone',
    size: { width: 390, height: 844 },
    async setup(page) {
      await fresh(page);
    },
    marks: (page) => [
      { n: 1, at: page.getByRole('button', { name: 'Side panel' }), side: 'bottom' },
      { n: 2, at: page.getByRole('button', { name: 'Inspector' }), side: 'bottom' },
      { n: 3, at: page.locator('.canvas-tools'), side: 'right' },
      { n: 4, at: page.locator('.stage-hint .bar-hint').first(), side: 'top' },
      { n: 5, at: page.locator('.toolbar').first(), side: 'right' },
    ],
  },
];

/** The styles side by side: the same scene in four of them. */
const STYLES = ['Line art', 'Watercolour', 'Anime', '3D'];

async function styles(page: Page) {
  await template(page, /^Café meeting/);
  await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.store.select(null));
  await page.evaluate(() => (window as unknown as { __poseStudio: Hook }).__poseStudio.store.setTime(10));
  const tiles: Buffer[] = [];
  for (const st of STYLES) {
    await page.getByRole('button', { name: 'Render style' }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${st}`) }).click();
    await idle(page, 6000);
    const box = (await page.locator('.stage').boundingBox())!;
    // (A lit style in a software renderer can take a while to draw a frame.)
    tiles.push(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height - 210 }, timeout: 180_000 }));
  }
  const meta = await sharp(tiles[0]).metadata();
  const [w, h] = [Math.round(meta.width! / 2), Math.round(meta.height! / 2)];
  const small = await Promise.all(tiles.map((t) => sharp(t).resize(w, h).toBuffer()));
  await sharp({ create: { width: w * 2 + 6, height: h * 2 + 6, channels: 3, background: '#ffffff' } })
    .composite(small.map((input, i) => ({ input, left: (i % 2) * (w + 6), top: Math.floor(i / 2) * (h + 6) })))
    .png({ palette: true, quality: 90 })
    .toFile(`${OUT}/styles.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  for (const shot of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
    const page = await browser.newPage({ viewport: shot.size ?? { width: 1400, height: 880 } });
    await page.goto(url);
    await canvas(page).waitFor({ timeout: 180_000 });
    await idle(page, 2000);
    try {
      await shot.setup(page);
      if (shot.marks) await drawMarks(page, shot.marks(page));
      const png = await page.screenshot({ ...(shot.clip ? { clip: await shot.clip() } : {}), timeout: 180_000 });
      await sharp(png).png({ palette: true, quality: 90 }).toFile(`${OUT}/${shot.name}.png`);
      console.log('ok', shot.name);
    } catch (e) {
      console.log('FAILED', shot.name, String((e as Error).message).split('\n')[0]);
    }
    await page.close();
  }
  if (!only.length || only.includes('styles')) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
    await page.goto(url);
    await canvas(page).waitFor({ timeout: 180_000 });
    await styles(page);
    console.log('ok styles');
    await page.close();
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
