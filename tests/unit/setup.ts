import { beforeAll } from 'vitest';
import { loadPhysics } from '@/lib/physics';

// Props fly with the physics engine, as in the app once it has loaded.
beforeAll(() => loadPhysics());

// three's file loader reports progress with the browser's ProgressEvent.
globalThis.ProgressEvent ??= class extends Event {
  lengthComputable = false;
  loaded = 0;
  total = 0;
} as unknown as typeof ProgressEvent;
