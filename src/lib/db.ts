import { PrismaClient } from '@prisma/client';

// Next.js hot-reloads modules in dev; without the global cache every reload
// would open another connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Supabase offers the same database on two ports, and the right one depends on
 * how the app is running.
 *
 *   5432  session mode      - one server connection held per client, for as
 *                             long as the client lives. Fast, and correct for
 *                             a single long-lived server on one office PC.
 *   6543  transaction mode  - a server connection only for the length of a
 *                             statement, shared between clients.
 *
 * A hosted deployment runs many copies of the app at once, and each copy on
 * session mode pins a connection it mostly is not using. The pool is 15, so the
 * copies exhaust it between them and everything - the app, a laptop, a backup -
 * is refused with "max clients reached in session mode". That is exactly what
 * happened on Vercel.
 *
 * So on a serverless host a session-mode pooler URL is moved to transaction
 * mode here, rather than depending on whoever typed it into the dashboard. Only
 * Supabase's pooler host is touched, and only port 5432: a direct database
 * connection is left exactly as given.
 */
export function poolerUrlFor(url: string | undefined, serverless: boolean): string | undefined {
  if (!url || !serverless) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // Not parseable: leave it to Prisma to report properly.
  }
  if (!parsed.hostname.endsWith('pooler.supabase.com') || parsed.port !== '5432') return url;

  parsed.port = '6543';
  parsed.searchParams.set('pgbouncer', 'true');
  return parsed.toString();
}

const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const datasourceUrl = poolerUrlFor(process.env.DATABASE_URL, serverless);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl && datasourceUrl !== process.env.DATABASE_URL ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
