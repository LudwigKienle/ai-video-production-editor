import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';
import { getCatalogItemById, getCatalogItemByPriceId } from '../../src/config/stripe';
import type { ApiRequest, ApiResponse } from '../types';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecretKey
    ? new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
    : null;

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
    : null;

export const config = {
    api: {
        bodyParser: false,
    },
};

const normalizeStatus = (status?: string | null) => {
    if (!status) return 'active';
    if (['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'].includes(status)) {
        return status;
    }
    return 'active';
};

const upsertTeamBilling = async (payload: {
    teamId: string;
    mode?: string | null;
    planId?: string | null;
    status?: string | null;
    byoEntitled?: boolean | null;
    trialActive?: boolean | null;
    creditDeltaCents?: number;
}) => {
    if (!supabaseAdmin) return;
    const { teamId, mode, planId, status, byoEntitled, trialActive, creditDeltaCents } = payload;

    const { data: existing } = await supabaseAdmin
        .from('team_billing')
        .select('credit_balance_cents')
        .eq('team_id', teamId)
        .maybeSingle();

    const currentBalance = existing?.credit_balance_cents || 0;
    const nextBalance = currentBalance + (creditDeltaCents || 0);

    await supabaseAdmin
        .from('team_billing')
        .upsert({
            team_id: teamId,
            mode: mode ?? 'trial',
            plan_id: planId ?? null,
            status: status ?? 'active',
            byo_entitled: byoEntitled ?? false,
            trial_active: trialActive ?? false,
            credit_balance_cents: nextBalance,
            updated_at: new Date().toISOString(),
            last_usage_at: creditDeltaCents ? new Date().toISOString() : undefined,
        }, { onConflict: 'team_id' });
};

const insertCreditLedger = async (payload: {
    teamId: string;
    deltaCents: number;
    reason: string;
    source: string;
    stripeEventId: string;
}) => {
    if (!supabaseAdmin) return;
    await supabaseAdmin.from('credit_ledger').insert({
        team_id: payload.teamId,
        delta_cents: payload.deltaCents,
        reason: payload.reason,
        source: payload.source,
        stripe_event_id: payload.stripeEventId,
        created_at: new Date().toISOString(),
    });
};

const resolveTeamIdByCustomer = async (customerId?: string | null) => {
    if (!supabaseAdmin || !customerId) return null;
    const { data } = await supabaseAdmin
        .from('billing_accounts')
        .select('team_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
    return data?.team_id || null;
};

const markEventProcessed = async (event: Stripe.Event): Promise<boolean> => {
    if (!supabaseAdmin) return false;
    const { error } = await supabaseAdmin
        .from('billing_events')
        .insert({
            stripe_event_id: event.id,
            type: event.type,
            payload: event as any,
            created_at: new Date().toISOString(),
        });

    if (!error) return true;

    if (error.code === '23505') {
        return false;
    }

    throw new Error(error.message);
};

const resolvePriceIdFromSession = async (sessionId: string): Promise<string | null> => {
    if (!stripe) return null;
    const full = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items.data.price'],
    });
    const priceId = full.line_items?.data?.[0]?.price?.id;
    return priceId || null;
};

const handleCheckoutSessionCompleted = async (event: Stripe.Event, session: Stripe.Checkout.Session) => {
    if (!stripe || !supabaseAdmin) return;

    const teamId = session.metadata?.teamId;
    const customerId = typeof session.customer === 'string' ? session.customer : null;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
    if (!teamId || !customerId) return;

    const priceId = await resolvePriceIdFromSession(session.id);
    const plan = getCatalogItemByPriceId(priceId || '') || getCatalogItemById(session.metadata?.planId);
    if (!plan) return;

    await supabaseAdmin
        .from('billing_accounts')
        .upsert({
            team_id: teamId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: session.payment_status || 'paid',
            price_id: priceId || null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'team_id' });

    if (plan.mode === 'credit_pack') {
        await upsertTeamBilling({
            teamId,
            mode: 'hosted_plan',
            planId: 'credits',
            status: 'active',
            trialActive: false,
            creditDeltaCents: plan.includedCreditsCents,
        });
        await insertCreditLedger({
            teamId,
            deltaCents: plan.includedCreditsCents,
            reason: 'credit_pack_purchase',
            source: 'stripe',
            stripeEventId: event.id,
        });
        return;
    }

    if (plan.mode === 'byo') {
        await upsertTeamBilling({
            teamId,
            mode: 'byo',
            planId: 'byo',
            status: 'active',
            byoEntitled: true,
            trialActive: false,
        });
        return;
    }

    await upsertTeamBilling({
        teamId,
        mode: plan.mode,
        planId: plan.id,
        status: 'active',
        trialActive: false,
    });
};

const handleSubscriptionUpdated = async (subscription: Stripe.Subscription) => {
    if (!supabaseAdmin) return;
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
    const teamId = await resolveTeamIdByCustomer(customerId);
    if (!teamId) return;

    const priceId = subscription.items.data[0]?.price?.id || null;
    const plan = getCatalogItemByPriceId(priceId);
    const status = normalizeStatus(subscription.status);

    await supabaseAdmin
        .from('billing_accounts')
        .upsert({
            team_id: teamId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            status,
            price_id: priceId,
            current_period_end: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
            cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
            updated_at: new Date().toISOString(),
        }, { onConflict: 'team_id' });

    await upsertTeamBilling({
        teamId,
        mode: plan?.mode || 'hosted_plan',
        planId: plan?.id || null,
        status,
        trialActive: false,
    });
};

const handleInvoicePaid = async (event: Stripe.Event, invoice: Stripe.Invoice) => {
    if (!supabaseAdmin) return;

    const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
    const teamId = await resolveTeamIdByCustomer(customerId);
    if (!teamId) return;

    const priceId = invoice.lines.data[0]?.price?.id || null;
    const plan = getCatalogItemByPriceId(priceId);
    if (!plan || plan.mode === 'credit_pack' || plan.mode === 'byo') return;
    if (plan.includedCreditsCents <= 0) return;

    await upsertTeamBilling({
        teamId,
        mode: plan.mode,
        planId: plan.id,
        status: 'active',
        trialActive: false,
        creditDeltaCents: plan.includedCreditsCents,
    });
    await insertCreditLedger({
        teamId,
        deltaCents: plan.includedCreditsCents,
        reason: 'subscription_cycle_credits',
        source: 'stripe',
        stripeEventId: event.id,
    });
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    if (!stripe || !supabaseAdmin || !webhookSecret) {
        return res.status(500).send('Stripe webhook is not configured.');
    }

    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
        return res.status(400).send('Missing Stripe signature');
    }

    let event: Stripe.Event;
    try {
        const rawBody = await buffer(req);
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error: any) {
        console.error('Webhook signature verification failed:', error?.message);
        return res.status(400).send(`Webhook Error: ${error?.message}`);
    }

    try {
        const isNewEvent = await markEventProcessed(event);
        if (!isNewEvent) {
            return res.status(200).json({ received: true, duplicate: true });
        }

        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event, event.data.object as Stripe.Checkout.Session);
                break;
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;
            case 'invoice.paid':
                await handleInvoicePaid(event, event.data.object as Stripe.Invoice);
                break;
            default:
                break;
        }
    } catch (error: any) {
        console.error('Webhook handling failed:', error?.message || error);
        return res.status(500).send('Webhook handler failed');
    }

    return res.status(200).json({ received: true });
}
