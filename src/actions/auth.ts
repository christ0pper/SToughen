'use server';

import { redirect } from 'next/navigation';
import { authenticate, createSession, destroySession } from '@/lib/auth';

export interface FormState {
  error?: string;
  message?: string;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Enter your email and password.' };

  const user = await authenticate(email, password);
  if (!user) return { error: 'Those credentials were not recognised.' };

  await createSession(user);
  redirect('/periods');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/login');
}
