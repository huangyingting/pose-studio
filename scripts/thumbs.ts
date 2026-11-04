// The built-in scene templates' and lighting schemes' thumbnails (public/templates/thumbs/<id>.webp,
// public/lighting/thumbs/<id>.webp): each as the app draws it, taken from a running app (New scene's
// tiles, the Library's Lighting), with ?draw-thumbs so that it draws them. Drawn in the app instead,
// they hold the page up for seconds where the GPU is slow or there is none (a staged template's set,
// the schemes' first shading). Run after changing a template or a scheme, with `npm run dev` going:
// `npm run thumbs` (or `npm run thumbs -- http://localhost:3000/ [id…]`).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { LIGHTING_PRESETS } from '../lib/lighting';
import { SCENE_TEMPLATES, SHOOT_PRESETS } from '../lib/templates';

const [url = 'http://localhost:3000/', ...only] = process.argv.slice(2);
const SIZE = 144;

/** A tile's picture (a PNG data URL) as a WebP thumbnail. */
async function save(file: string, src: string | null) {
  const webp = await sharp(Buffer.from(src!.split(',')[1], 'base64')).resize(SIZE, SIZE).webp({ quality: 85, alphaQuality: 90 }).toBuffer();
  await writeFile(file, webp);
  console.log(`${file.padEnd(44)} ${(webp.byteLength / 1024).toFixed(1)} KB`);
}

async function main() {
  await mkdir('public/templates/thumbs', { recursive: true });
  await mkdir('public/lighting/thumbs', { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}draw-thumbs`);
  await page.locator('.stage canvas').waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: 'New scene…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New scene' });
  // (People standing together are drawn in the app: two of them, and no set.)
  for (const t of SCENE_TEMPLATES.filter((x) => x.group !== 'Standing together' && (!only.length || only.includes(x.id)))) {
    // (Its tile: the shoot preset that films it, where there is one, else its own.)
    const name = SHOOT_PRESETS.find((p) => p.template === t.id)?.name ?? t.name;
    const tile = dialog.locator('.start-open').filter({ has: page.locator('.start-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
    await tile.scrollIntoViewIfNeeded();
    const img = tile.locator('.start-thumb img');
    await img.waitFor({ timeout: 300_000 });
    await save(`public/templates/thumbs/${t.id}.webp`, await img.getAttribute('src'));
  }
  await page.keyboard.press('Escape');
  // The lighting schemes: the Library's Lighting, each tile.
  await page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Lighting' }).click();
  for (const l of LIGHTING_PRESETS.filter((x) => !only.length || only.includes(x.id))) {
    const tile = page.locator('.lib-grid').getByRole('button', { name: l.name, exact: true });
    await tile.scrollIntoViewIfNeeded();
    const img = tile.locator('.lib-thumb img');
    await img.waitFor({ timeout: 300_000 });
    await save(`public/lighting/thumbs/${l.id}.webp`, await img.getAttribute('src'));
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
