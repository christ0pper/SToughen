'use server';

import { redirect } from 'next/navigation';
import { authenticate, createSession, destroySession } from '@/lib/auth';
import { describeSignInFailure } from '@/lib/configCheck';
import { clearFailures, describeWait, recordFailure, retryAfterSeconds } from '@/lib/loginThrottle';

export interface FormState {
  error?: string;
  message?: string;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Enter your username and password.' };

  const username = email.trim().toLowerCase();
  const wait = retryAfterSeconds(username);
  if (wait > 0) {
    return { error: `Too many failed sign-ins for that username. Try again in ${describeWait(wait)}.` };
  }

  let user;
  try {
    user = await authenticate(email, password);
    if (!user) {
      recordFailure(username);
      return { error: 'Those credentials were not recognised.' };
    }
    clearFailures(username);
    await createSession(user);
  } catch (error) {
    // Without this the browser gets a bare 500 and the person at the keyboard
    // is told nothing at all - see lib/configCheck.
    console.error('[signIn] failed', error);
    return { error: describeSignInFailure(error) };
  }

  // Outside the try: redirect works by throwing, and the catch above would
  // report it as a sign-in failure.
  redirect('/periods');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/login');
}
