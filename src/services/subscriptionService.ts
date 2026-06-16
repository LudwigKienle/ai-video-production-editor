
import { getSupabase } from '../lib/supabase'; // Assuming centralized supabase client

const readApiError = async (response: Response, fallback: string) => {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error;
    }
    if (payload && typeof payload.message === 'string' && payload.message.trim()) {
        return payload.message;
    }
    return fallback;
};

export const subscriptionService = {
    async resolveSession() {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Supabase client not initialized');
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) throw new Error('User not logged in');
        return data.session;
    },

    async resolveTeamId() {
        const session = await this.resolveSession();
        const supabase = getSupabase();
        if (!supabase) throw new Error('Supabase client not initialized');

        const user = session.user;
        if (!user) throw new Error('User not logged in');

        const { data: member } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

        const teamFromMember = (member as { team_id: string } | null)?.team_id;
        if (teamFromMember) return teamFromMember;

        const bootstrapResponse = await fetch('/api/billing/bootstrap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                email: user.email,
                name: user.user_metadata?.name || user.user_metadata?.full_name,
            }),
        });

        if (!bootstrapResponse.ok) {
            const payload = await bootstrapResponse.json().catch(() => ({}));
            throw new Error(payload?.error || 'Unable to bootstrap billing team');
        }

        const payload = await bootstrapResponse.json();
        if (!payload?.teamId) {
            throw new Error('User has no team');
        }
        return payload.teamId as string;
    },

    async checkout(selection: string) {
        const session = await this.resolveSession();
        const teamId = await this.resolveTeamId();

        const trimmedSelection = selection.trim();
        const normalizedSelection = trimmedSelection.toLowerCase() === 'byok' ? 'byo' : trimmedSelection;
        const isPriceId = normalizedSelection.startsWith('price_');

        // 2. Call Backend API
        const response = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                priceId: isPriceId ? normalizedSelection : undefined,
                planKey: isPriceId ? undefined : normalizedSelection,
                teamId,
                successUrl: window.location.origin + '/portal.html#/billing?success=1',
                cancelUrl: window.location.origin + '/portal.html#/billing?canceled=1',
            }),
        });

        if (!response.ok) {
            throw new Error(await readApiError(response, 'Checkout failed'));
        }

        const { url } = await response.json();
        if (url) {
            window.location.href = url;
        } else {
            throw new Error('No checkout URL returned');
        }
    },

    async openCustomerPortal() {
        const session = await this.resolveSession();
        const teamId = await this.resolveTeamId();

        const response = await fetch('/api/stripe/portal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                teamId,
                returnUrl: window.location.origin + '/portal.html#/billing',
            }),
        });

        if (!response.ok) {
            throw new Error(await readApiError(response, 'Portal failed'));
        }

        const { url } = await response.json();
        if (url) {
            window.location.href = url;
        } else {
            throw new Error('No billing portal URL returned');
        }
    }
};
