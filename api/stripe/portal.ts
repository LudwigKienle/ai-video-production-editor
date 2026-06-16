import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { ApiRequest, ApiResponse } from '../types';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey
    ? new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
    : null;

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
    : null;

const resolveAppUrl = (req: ApiRequest) => {
    const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (explicit) return explicit;
    const host = req.headers.host;
    if (!host) return 'http://localhost:5173';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    return `${protocol}://${host}`;
};

const takeFirst = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;

const getBearerToken = (req: ApiRequest): string | null => {
    const header = takeFirst((req.headers.authorization || req.headers.Authorization) as string | string[] | undefined);
    if (!header || typeof header !== 'string') return null;
    if (!header.toLowerCase().startsWith('bearer ')) return null;
    return header.slice(7).trim();
};

const authorizeTeamMember = async (req: ApiRequest, teamId: string) => {
    if (!supabaseAdmin) {
        return { ok: false as const, status: 500, error: 'Supabase service role is not configured.' };
    }
    const token = getBearerToken(req);
    if (!token) {
        return { ok: false as const, status: 401, error: 'Missing authorization token' };
    }
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
        return { ok: false as const, status: 401, error: 'Invalid session token' };
    }

    const { data: member, error: memberError } = await supabaseAdmin
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', authData.user.id)
        .maybeSingle();

    if (memberError) {
        return { ok: false as const, status: 500, error: memberError.message };
    }

    if (!member) {
        return { ok: false as const, status: 403, error: 'No access to this team' };
    }

    return { ok: true as const };
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!stripe || !supabaseAdmin) {
        return res.status(500).json({ error: 'Stripe or Supabase service role is not configured.' });
    }

    const { teamId, returnUrl } = req.body || {};
    if (!teamId) {
        return res.status(400).json({ error: 'Missing teamId' });
    }

    const access = await authorizeTeamMember(req, teamId);
    if (!access.ok) {
        return res.status(access.status).json({ error: access.error });
    }

    try {
        const { data: billingAccount, error } = await supabaseAdmin
            .from('billing_accounts')
            .select('stripe_customer_id')
            .eq('team_id', teamId)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!billingAccount?.stripe_customer_id) {
            return res.status(404).json({ error: 'No Stripe customer found for this team' });
        }

        const appUrl = resolveAppUrl(req);
        const session = await stripe.billingPortal.sessions.create({
            customer: billingAccount.stripe_customer_id,
            return_url: returnUrl || `${appUrl}/portal.html#/billing`,
        });

        return res.status(200).json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe portal error:', error);
        return res.status(500).json({ error: error?.message || 'Failed to create billing portal session' });
    }
}
