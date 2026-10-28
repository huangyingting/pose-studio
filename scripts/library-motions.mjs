#!/usr/bin/env node
// The Library's motions from clip files (Pose Studio's own format, as "Import motion…" makes them):
// each *.clip.json in data/library/motions (or the folder given) is copied to public/motions as
// <slug>.json with the id library:<slug>, and public/motions/index.json lists them, each in a group
// of the Library's Motions. Run with `npm run motions` after adding clips there.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const from = process.argv[2] ?? 'data/library/motions';
const to = 'public/motions';

// The group a motion goes in, by its name (the first that matches; Everyday otherwise).
const GROUPS = [
  [/danc|salsa|rumba/i, 'Dance'],
  [/flip|baseball|golf|football|soccer|capoeira|jump|landing/i, 'Sport & gymnastics'],
  [/punch|kick|jab|uppercut|hook|block|dodge|sword|death|hit reaction|aim|shoot/i, 'Fighting'],
  [/walk|run|jog|sprint|strafe|stairs|ladder|turn/i, 'Getting around'],
];
const groupOf = (name) => GROUPS.find(([re]) => re.test(name))?.[1] ?? 'Everyday';
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const files = (await readdir(from)).filter((f) => f.endsWith('.clip.json')).sort();
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
const index = [];
for (const file of files) {
  const clip = JSON.parse(await readFile(join(from, file), 'utf8'));
  const name = clip.name || file.replace(/\.clip\.json$/, '');
  const id = slug(name);
  if (index.some((m) => m.id === `library:${id}`)) throw new Error(`Two motions are called ${name}`);
  await writeFile(join(to, `${id}.json`), JSON.stringify({ ...clip, id: `library:${id}`, name }));
  index.push({ id: `library:${id}`, name, duration: clip.duration, group: groupOf(name) });
}
await writeFile(join(to, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`${index.length} motions in ${to}`);
