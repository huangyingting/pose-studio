import { readFileSync } from 'node:fs';
import { beforeAll } from 'vitest';
import { LIBRARY, putClips } from '@/lib/assets';
import { parseClip } from '@/lib/doc';
import { PRIMITIVES } from '@/lib/locomotion';
import { loadPhysics } from '@/lib/physics';

// The recordings walks, runs, jumps and turns go with, at hand as in the app once a project opens.
putClips(PRIMITIVES.map((id) => parseClip(JSON.parse(readFileSync(`public/motions/${id.slice(LIBRARY.length)}.json`, 'utf8')))!));

// Props fly with the physics engine, as in the app once it has loaded.
beforeAll(() => loadPhysics());

// three's file loader reports progress with the browser's ProgressEvent.
globalThis.ProgressEvent ??= class extends Event {
  lengthComputable = false;
  loaded = 0;
  total = 0;
} as unknown as typeof ProgressEvent;
