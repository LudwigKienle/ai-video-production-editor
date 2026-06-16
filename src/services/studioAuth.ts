import type { User } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';

export type StudioAuthUser = {
  id: string;
  email: string;
  name: string;
};

const buildStudioUser = (authUser: User): StudioAuthUser => {
  const email = authUser.email || 'unknown';
  const name =
    authUser.user_metadata?.name ||
    authUser.user_metadata?.full_name ||
    email.split('@')[0] ||
    'Creator';
  return { id: authUser.id, email, name };
};

export const resolveStudioUser = async (): Promise<StudioAuthUser | null> => {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const authUser = data.session?.user;
  if (!authUser) return null;
  return buildStudioUser(authUser);
};

export const loginWithEmail = async (email: string) => {
  const client = getSupabase();
  if (!client) {
    console.error('Supabase client invalid. Check env vars.');
    throw new Error('Authentication service not configured');
  }
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
};

export const loginWithProvider = async (provider: 'google' | 'discord') => {
  const client = getSupabase();
  if (!client) {
    console.error('Supabase client invalid. Check env vars.');
    throw new Error('Authentication service not configured');
  }
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
};

export const logoutStudio = async () => {
  const client = getSupabase();
  if (!client) return;
  await client.auth.signOut();
};

export const onStudioAuthChange = (callback: (user: StudioAuthUser | null) => void) => {
  const client = getSupabase();
  if (!client) return () => undefined;
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    const authUser = session?.user;
    callback(authUser ? buildStudioUser(authUser) : null);
  });
  return () => {
    data.subscription.unsubscribe();
  };
};
