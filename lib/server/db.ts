import 'server-only';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

/* Server edition database: SQLite through Prisma (one client per process). */

export const DATABASE_URL = process.env.DATABASE_URL ?? 'file:./data/pose-studio.db';

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: DATABASE_URL }) });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
