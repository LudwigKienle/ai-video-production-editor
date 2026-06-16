import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { Database } from '../types/supabase'; // We will generate this next

let client: SupabaseClient<Database> | null = null;

// Singleton instance getter
export const getSupabase = (): SupabaseClient<Database> | null => {
    if (client) return client;

    if (!env.supabase.url || !env.supabase.anonKey) {
        return null;
    }

    client = createClient<Database>(env.supabase.url, env.supabase.anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    });

    return client;
};
