// The sets' thumbnails for the Library (public/sets/thumbs/<id>.webp): each set's preview as the
// app draws it, in line art with all its models (or its scene) in, taken from a running app (its
// Library → Sets, each tile's preview). Drawn in the app instead, the grid would fetch every set's
// models to show itself. Run after `npm run sets`, with `npm run dev` going:
// `npm run set-thumbs` (or `npm run set-thumbs -- http://localhost:3000/ [set id…]`).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { SETS } from '../lib/sets';

const [url = 'http://localhost:3000/', ...only] = process.argv.slice(2);
const OUT = 'public/sets/thumbs';
const SIZE = 144;

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url);
  await page.locator('.stage canvas').waitFor({ timeout: 120_000 });
  await page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Sets' }).click();
  for (const s of SETS.filter((x) => !only.length || only.includes(x.id))) {
    const tile = page.locator('.lib-grid').getByRole('button', { name: s.name, exact: true });
    await tile.scrollIntoViewIfNeeded();
    await tile.hover();
    // (Its preview, once its models have come and it is drawn.)
    const card = page.locator('.lib-preview', { has: page.getByText(s.name, { exact: true }) });
    const img = card.locator('img');
    await img.waitFor({ timeout: 120_000 });
    const src = await img.getAttribute('src');
    const png = Buffer.from(src!.split(',')[1], 'base64');
    // (The middle of it, square: the set round the figure.)
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const side = Math.min(width, height);
    const webp = await sharp(png).extract({ left: Math.round((width - side) / 2), top: Math.round((height - side) / 2), width: side, height: side }).resize(SIZE, SIZE).webp({ quality: 80 }).toBuffer();
    await writeFile(`${OUT}/${s.id}.webp`, webp);
    console.log(`${s.id.padEnd(16)} ${(webp.byteLength / 1024).toFixed(1)} KB`);
    await page.mouse.move(1200, 880);
    await card.waitFor({ state: 'detached' });
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
