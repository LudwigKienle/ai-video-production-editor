import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getCatalogItemById, getCatalogItemByPriceId, getPriceIdForKey } from '../../src/config/stripe';
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

const clean = (value: unknown, max = 255): string | undefined => {
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    if (!text) return undefined;
    return text.slice(0, max);
};

const getStripeAddress = (body: Record<string, unknown>) => {
    const country = clean(body.country, 2)?.toUpperCase();
    const line1 = clean(body.addressLine1, 255);
    const city = clean(body.city, 120);
    const postalCode = clean(body.postalCode, 40);
    if (!country && !line1 && !city && !postalCode) return undefined;
    return {
        country,
        line1,
        city,
        postal_code: postalCode,
    };
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

    return {
        ok: true as const,
        user: authData.user,
    };
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!stripe || !supabaseAdmin) {
        return res.status(500).json({ error: 'Stripe or Supabase service role is not configured.' });
    }

    const {
        teamId,
        priceId,
        planKey,
        successUrl,
        cancelUrl,
        email,
        name,
        phone,
        company,
        vatId,
        country,
        addressLine1,
        city,
        postalCode,
    } = req.body || {};

    if (!teamId) {
        return res.status(400).json({ error: 'Missing teamId' });
    }

    const access = await authorizeTeamMember(req, teamId);
    if (!access.ok) {
        return res.status(access.status).json({ error: access.error });
    }

    const rawRequested = (priceId || planKey || '').toString().trim();
    const requested = rawRequested.toLowerCase() === 'byok' ? 'byo' : rawRequested;
    const normalizedPlanKey =
        typeof planKey === 'string' && planKey.trim().toLowerCase() === 'byok'
            ? 'byo'
            : planKey;
    if (!requested) {
        return res.status(400).json({ error: 'Missing priceId or planKey' });
    }

    const resolvedPriceId = getPriceIdForKey(requested);
    if (!resolvedPriceId) {
        return res.status(400).json({ error: `Unknown plan or invalid price id: ${requested}` });
    }

    const plan =
        getCatalogItemByPriceId(resolvedPriceId) ||
        getCatalogItemById(normalizedPlanKey) ||
        getCatalogItemById(requested);
    if (!plan) {
        return res.status(400).json({ error: `Unable to resolve billing plan for ${requested}` });
    }

    try {
        const { data: billingAccount, error: billingAccountError } = await supabaseAdmin
            .from('billing_accounts')
            .select('stripe_customer_id')
            .eq('team_id', teamId)
            .maybeSingle();
        if (billingAccountError) {
            return res.status(500).json({ error: billingAccountError.message });
        }

        let customerId = billingAccount?.stripe_customer_id || null;
        const customerEmail = clean(email, 200) || access.user.email || undefined;
        const customerName =
            clean(name, 160) ||
            clean(access.user.user_metadata?.name, 160) ||
            clean(access.user.user_metadata?.full_name, 160);
        const customerPhone = clean(phone, 60);
        const customerAddress = getStripeAddress({ country, addressLine1, city, postalCode });
        const customerMetadata: Record<string, string> = {
            teamId: String(teamId),
            userId: access.user.id,
            company: clean(company, 200) || '',
            vatId: clean(vatId, 80) || '',
        };

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: customerEmail,
                name: customerName,
                phone: customerPhone,
                address: customerAddress,
                metadata: customerMetadata,
            });
            customerId = customer.id;

            const { error: upsertBillingAccountError } = await supabaseAdmin
                .from('billing_accounts')
                .upsert({
                    team_id: teamId,
                    stripe_customer_id: customerId,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'team_id' });
            if (upsertBillingAccountError) {
                return res.status(500).json({ error: upsertBillingAccountError.message });
            }
        } else {
            await stripe.customers.update(customerId, {
                email: customerEmail,
                name: customerName,
                phone: customerPhone,
                address: customerAddress,
                metadata: customerMetadata,
            });
        }

        const appUrl = resolveAppUrl(req);
        const mode: Stripe.Checkout.SessionCreateParams.Mode =
            plan.interval === 'one_time' ? 'payment' : 'subscription';

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode,
            line_items: [{ price: resolvedPriceId, quantity: 1 }],
            success_url: successUrl || `${appUrl}/portal.html#/billing?success=1`,
            cancel_url: cancelUrl || `${appUrl}/portal.html#/billing?canceled=1`,
            allow_promotion_codes: true,
            client_reference_id: teamId,
            metadata: {
                teamId,
                planId: plan.id,
                mode: plan.mode,
            },
            subscription_data: mode === 'subscription'
                ? {
                    metadata: {
                        teamId,
                        planId: plan.id,
                        mode: plan.mode,
                    },
                }
                : undefined,
        });

        return res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
        console.error('Stripe checkout error:', error);
        return res.status(500).json({ error: error?.message || 'Stripe checkout failed' });
    }
}
