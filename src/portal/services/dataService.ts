import { demoProjects, demoTeams, demoUsage } from '../data';
import { getSupabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';

// Helper types derived from the database schema
type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Team = Tables<'teams'>;
export type Project = Tables<'projects'>;
export type Usage = Tables<'usage_events'>;

const fallback: { teams: Team[], projects: Project[], usage: Usage[] } = {
  teams: demoTeams as any, // Demo data might not match strict DB schema
  projects: demoProjects as any,
  usage: demoUsage as any,
};

export const fetchTeams = async (): Promise<Team[]> => {
  const client = getSupabase();
  if (!client) return fallback.teams;
  const { data, error } = await client.from('teams').select('*');
  if (error || !data) {
    console.warn('Supabase teams fetch failed', error?.message || error);
    return [];
  }
  return data;
};

export const fetchProjects = async (): Promise<Project[]> => {
  const client = getSupabase();
  if (!client) return fallback.projects;
  const { data, error } = await client.from('projects').select('*');
  if (error || !data) {
    console.warn('Supabase projects fetch failed', error?.message || error);
    return [];
  }
  return data;
};

export const fetchUsage = async (): Promise<Usage[]> => {
  const client = getSupabase();
  if (!client) return fallback.usage;
  const { data, error } = await client.from('usage_events').select('*');
  if (error || !data) {
    console.warn('Supabase usage fetch failed', error?.message || error);
    return [];
  }
  return data;
};

export const fetchTeamById = async (id: string): Promise<Team | null> => {
  const client = getSupabase();
  if (!client) return fallback.teams.find(team => team.id === id) || null;
  const { data, error } = await client.from('teams').select('*').eq('id', id).single();
  if (error) {
    console.warn('Supabase team fetch failed', error?.message || error);
  }
  return data;
};

export const fetchProjectById = async (id: string): Promise<Project | null> => {
  const client = getSupabase();
  if (!client) return fallback.projects.find(project => project.id === id) || null;
  const { data, error } = await client.from('projects').select('*').eq('id', id).single();
  if (error) {
    console.warn('Supabase project fetch failed', error?.message || error);
  }
  return data;
};
