import { defineConfig } from 'prisma/config';

// Server edition database (SQLite). DATABASE_URL defaults to a file next to the app.
try {
  process.loadEnvFile?.('.env');
} catch {
  // No .env: use the environment as is.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'file:./data/pose-studio.db' },
});
