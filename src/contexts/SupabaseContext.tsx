import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { Database } from '../types/supabase';

type SupabaseContextType = {
    supabase: SupabaseClient<Database> | null;
    session: Session | null;
    isLoading: boolean;
};

const SupabaseContext = createContext<SupabaseContextType>({
    supabase: null,
    session: null,
    isLoading: true,
});

export const useSupabase = () => useContext(SupabaseContext);

export const SupabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = getSupabase();

    useEffect(() => {
        if (!supabase) {
            setIsLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setIsLoading(false);
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [supabase]);

    return (
        <SupabaseContext.Provider value={{ supabase, session, isLoading }}>
            {children}
        </SupabaseContext.Provider>
    );
};
