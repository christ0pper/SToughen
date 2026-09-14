import { PrismaClient } from '@prisma/client';

// Next.js hot-reloads modules in dev; without the global cache every reload
// would open another connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pragmas?: Promise<void> };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

/**
 * SQLite defaults are tuned for a database on a local disk that nothing else
 * touches. This one lives in a synced folder, and an import writes thousands of
 * rows in a burst, which the defaults handle badly: every statement is its own
 * transaction with its own fsync, measured here at 10ms each.
 *
 *   delete journal, synchronous FULL   2980ms per 300 writes   (the default)
 *   WAL,            synchronous FULL   1007ms
 *   WAL,            synchronous NORMAL  140ms
 *
 * WAL is a property of the file and survives; synchronous is per connection and
 * has to be set each time.
 *
 * NORMAL is the safe half of the tradeoff, not the reckless one: SQLite
 * guarantees the database cannot corrupt in WAL mode at this level. What it
 * gives up is the last few committed transactions if the machine loses power
 * mid-write - a crash of the app itself is still safe. For an office PC running
 * one monthly batch, against a 21x speedup, that is the right side to be on,
 * and a lost import is re-runnable from the .xls it came from.
 */
async function applyPragmas(): Promise<void> {
  // These are SQLite settings. Postgres - Supabase, or a local server later -
  // tunes durability on the server itself and would reject a PRAGMA outright.
  if (!(process.env.DATABASE_URL ?? '').startsWith('file:')) return;

  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL');
    // Wait rather than fail if a second connection holds the write lock.
    await db.$queryRawUnsafe('PRAGMA busy_timeout=5000');
  } catch (error) {
    console.error('[db] could not apply SQLite pragmas', error);
  }
}

/**
 * Awaited by the first query that needs it. Kept on globalThis so a hot reload
 * does not re-run it, and so nothing races the first import of the module.
 */
export const dbReady: Promise<void> = globalForPrisma.pragmas ?? applyPragmas();
if (process.env.NODE_ENV !== 'production') globalForPrisma.pragmas = dbReady;
