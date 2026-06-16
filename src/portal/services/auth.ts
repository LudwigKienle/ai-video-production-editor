import type { User } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  teamId?: string;
  avatarUrl?: string;
  provider?: string;
};

const STORAGE_KEY = 'bw_portal_user';
const TEAM_STORAGE_KEY = 'bw_portal_team_id';

export const savePortalUser = (user: PortalUser | null) => {
  if (typeof window === 'undefined') return;
  if (!user) {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(TEAM_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  if (user.teamId) {
    window.localStorage.setItem(TEAM_STORAGE_KEY, user.teamId);
  } else {
    window.localStorage.removeItem(TEAM_STORAGE_KEY);
  }
};

export const getCurrentUser = (): PortalUser | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalUser;
  } catch {
    return null;
  }
};

const resolveDisplayName = (authUser: User, emailFallback?: string) => {
  return (
    authUser.user_metadata?.name ||
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.user_name ||
    authUser.email ||
    emailFallback ||
    'Team Member'
  );
};

const resolveProvider = (authUser: User): string => {
  const appProvider = authUser.app_metadata?.provider;
  if (appProvider) return String(appProvider);
  const identities = (authUser as any)?.identities as Array<{ provider?: string }> | undefined;
  const identityProvider = identities?.[0]?.provider;
  return identityProvider || 'email';
};

const buildPortalUser = async (authUser: User, emailFallback?: string): Promise<PortalUser> => {
  const client = getSupabase();
  type TeamMemberRow = Database['public']['Tables']['team_members']['Row'];
  const roleRecord = client
    ? await client
        .from('team_members')
        .select('role, team_id')
        .eq('user_id', authUser.id)
        .maybeSingle()
    : null;

  const roleData = (roleRecord?.data as Pick<TeamMemberRow, 'role' | 'team_id'> | null) ?? null;
  const role = roleData?.role ? (roleData.role as PortalUser['role']) : 'viewer';
  const teamId = roleData?.team_id || undefined;

  const user: PortalUser = {
    id: authUser.id,
    name: resolveDisplayName(authUser, emailFallback),
    email: authUser.email || emailFallback || 'unknown',
    role,
    teamId,
    avatarUrl: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || undefined,
    provider: resolveProvider(authUser),
  };
  savePortalUser(user);
  return user;
};

export const patchCurrentUser = (patch: Partial<PortalUser>): PortalUser | null => {
  const current = getCurrentUser();
  if (!current) return null;
  const next = { ...current, ...patch };
  savePortalUser(next);
  return next;
};

export const resolveCurrentUser = async (): Promise<PortalUser | null> => {
  const client = getSupabase();
  if (!client) {
    return getCurrentUser();
  }
  const { data } = await client.auth.getSession();
  const authUser = data.session?.user;
  if (!authUser) return null;
  return buildPortalUser(authUser);
};

export const login = async (email: string): Promise<PortalUser | null> => {
  const client = getSupabase();
  if (!client) {
    const user: PortalUser = {
      id: 'user-001',
      name: 'AI Video Production Editor Admin',
      email,
      role: 'owner',
    };
    savePortalUser(user);
    return user;
  }

  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) {
    throw error;
  }
  return null;
};

export const loginWithProvider = async (provider: 'google' | 'discord'): Promise<void> => {
  const client = getSupabase();
  if (!client) {
    throw new Error('Authentication service not configured');
  }

  const redirectTo = `${window.location.origin}/portal.html`;
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      queryParams: provider === 'google'
        ? { prompt: 'select_account' }
        : undefined,
    },
  });

  if (error) {
    throw error;
  }
};

export const logout = async () => {
  const client = getSupabase();
  if (client) {
    await client.auth.signOut();
  }
  savePortalUser(null);
};
