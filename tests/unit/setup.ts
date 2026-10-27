import { beforeAll } from 'vitest';
import { loadPhysics } from '@/lib/physics';

// Props fly with the physics engine, as in the app once it has loaded.
beforeAll(() => loadPhysics());
