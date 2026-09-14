/**
 * Session handling.
 *
 * The spec leaves the auth mechanism open, so this is deliberately small and
 * replaceable: a bcrypt password hash in the database, and a signed JWT in an
 * httpOnly cookie. No third-party identity provider, no password reset flow -
 * an Admin manages the handful of internal accounts directly.
 */

import { cookies, headers } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { db } from './db';

const COOKIE_NAME = 'payroll_session';
const SESSION_HOURS = 12;

export type Role = 'ADMIN' | 'HR_ACCOUNTANT';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  }
  return new TextEncoder().encode(value);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

/**
 * Whether this request actually arrived over HTTPS.
 *
 * The session cookie used to be marked Secure whenever NODE_ENV was
 * production, which is wrong in the one deployment this app is built for: a
 * production build on an office PC, reached from a phone at
 * http://192.168.x.x:3000. A browser will not store a Secure cookie over plain
 * HTTP, so sign-in appeared to work and then bounced straight back to the login
 * screen with nothing in any log.
 *
 * Next itself never terminates TLS, so HTTPS only ever arrives through a proxy
 * in front - and a proxy says so in this header. No header means a direct plain
 * HTTP connection, which is exactly the LAN case.
 *
 * The cost of that is real and worth stating: over plain HTTP on the LAN, the
 * password and this cookie cross the network readable by anything on the same
 * network. On a trusted office network that is usually accepted; putting a TLS
 * proxy in front is what removes it, and this function will then mark the
 * cookie Secure on its own.
 */
async function servedOverHttps(): Promise<boolean> {
  try {
    const proto = (await headers()).get('x-forwarded-proto');
    return proto?.split(',')[0].trim() === 'https';
  } catch {
    return false;
  }
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await servedOverHttps(),
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * The signed-in user, or null.
 *
 * The cookie proves who signed in; it does not prove the account still exists
 * or is still allowed in. Both have to be re-checked on every request:
 *
 *   - Disabling an account in Settings has to take effect now. Trusting the
 *     token alone let someone carry on working for the rest of the twelve-hour
 *     session after being switched off.
 *   - A deleted account left a token pointing at nothing. Every screen still
 *     rendered from the claims inside it, and the first write that recorded who
 *     did it died on a foreign key instead of asking the person to sign in.
 *
 * Name and role are read back from the database too, so a change to either
 * applies immediately rather than at next sign-in. That is one indexed lookup
 * by primary key per request against a local SQLite file holding a handful of
 * accounts - far cheaper than either of the bugs above.
 */
export async function getSession(): Promise<SessionUser | null> {
  if (authBypassEnabled()) {
    const standIn = await db.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true },
    });
    // With no Admin to stand in for there is nobody to attribute changes to,
    // so fall through and ask for a sign-in rather than run headless.
    if (standIn) {
      return { id: standIn.id, email: standIn.email, name: standIn.name, role: 'ADMIN' };
    }
  }

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  let subject: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    subject = payload.sub;
  } catch {
    return null;
  }

  const user = await db.user.findUnique({
    where: { id: subject },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (user.role === 'ADMIN' ? 'ADMIN' : 'HR_ACCOUNTANT') as Role,
  };
}

/**
 * Development-only sign-in bypass.
 *
 * Set AUTH_DISABLED=true in .env to stop being asked to sign in while building.
 * Three things keep it from ever reaching anybody else:
 *
 *   1. It reads an environment variable, and .env is gitignored. There is no
 *      way to commit it on by accident.
 *   2. It is ignored outright when NODE_ENV is production, so `npm run build`
 *      followed by `npm start` always asks for a password whatever .env says.
 *   3. While it is on, every screen carries a red banner, and `npm run
 *      preflight` fails.
 *
 * It stands in a real Admin row rather than inventing a user, because the audit
 * trail records who did each thing by foreign key - a made-up id would fail
 * that constraint the moment anything was written.
 */
export function authBypassEnabled(): boolean {
  return process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
}

export class UnauthorizedError extends Error {
  constructor(message = 'You must sign in to do that.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'That action is restricted to the Admin.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Admin-only: hourly rate, bank details, holidays, ESI threshold, lock/reopen. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ForbiddenError();
  return user;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN';
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.isActive) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === 'ADMIN' ? 'ADMIN' : 'HR_ACCOUNTANT',
  };
}
