#!/usr/bin/env node
/*
 * Applies prisma/migrations to the server edition's SQLite database at startup (Docker image),
 * without the Prisma CLI. It keeps Prisma's own bookkeeping table, so `prisma migrate deploy` and
 * this script agree on what has been applied.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const url = process.env.DATABASE_URL ?? 'file:./data/pose-studio.db';
if (!url.startsWith('file:')) throw new Error(`Only SQLite file URLs are supported, not ${url}`);
const file = resolve(url.slice('file:'.length));
mkdirSync(dirname(file), { recursive: true });

const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'prisma', 'migrations');
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL,
  "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);
const done = new Set(db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').all().map((r) => r.migration_name));

let applied = 0;
for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  if (done.has(name)) continue;
  const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
  const started = Date.now();
  db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)')
      .run(randomUUID(), createHash('sha256').update(sql).digest('hex'), Date.now(), name, started);
  })();
  applied++;
  console.log(`Applied migration ${name}`);
}
db.close();
console.log(applied ? `Database ready (${applied} migration${applied > 1 ? 's' : ''} applied)` : 'Database up to date');
