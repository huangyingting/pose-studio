/*
 * MediaPipe's pose landmarks for each prepared image (scripts/poses/prepare.py), in a headless
 * browser as the app finds them in a photo: its world (metres, hip-centred) and image landmarks.
 *
 *     node scripts/poses/detect.mjs <prepared dir> <landmarks.json>
 *
 * Serves the page, the MediaPipe bundle (node_modules), its model (public/mediapipe) and the
 * images itself; keeps what it found as it goes (run again to go on).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const [dir, out] = process.argv.slice(2);
const ROOTS = { '/tv/': 'node_modules/@mediapipe/tasks-vision/', '/mp/': 'public/mediapipe/', '/img/': `${dir}/` };
const PAGE = `<!doctype html><script type="module">
import { FilesetResolver, PoseLandmarker } from './tv/vision_bundle.mjs';
const lm = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('./mp/wasm'), {
  baseOptions: { modelAssetPath: './mp/pose_landmarker_full.task', delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 1,
  minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3 });
window.detect = async (name) => {
  const img = new Image(); img.src = './img/' + name; await img.decode();
  const r = lm.detect(img);
  return r.landmarks.length ? { image: r.landmarks[0], world: r.worldLandmarks[0] } : null;
};
document.title = 'ready';
</script>`;
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') return res.end(PAGE);
  const root = Object.entries(ROOTS).find(([p]) => url.startsWith(p));
  const file = root && join(root[1], url.slice(root[0].length));
  if (!file || !existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(0);
const data = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 120_000 });
const files = readdirSync(dir).filter((f) => f.endsWith('.png') && !(f in data));
for (const [i, f] of files.entries()) {
  data[f] = await page.evaluate((f) => window.detect(f), f);
  if (i % 25 === 24) writeFileSync(out, JSON.stringify(data));
}
writeFileSync(out, JSON.stringify(data));
console.log(`${Object.keys(data).length} images, a person found in ${Object.values(data).filter(Boolean).length}`);
await browser.close();
server.close();
