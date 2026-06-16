import React from 'react';
import { getCurrentUser, patchCurrentUser } from '../services/auth';
import { getSupabase } from '../../lib/supabase';
import {
  CREDIT_PACKAGES,
  STRIPE_PLANS,
  getCatalogItemByPriceId,
  type StripeCatalogItem,
} from '../../config/stripe';

type BillingAccount = {
  status?: string | null;
  price_id?: string | null;
  stripe_customer_id?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

type TeamBilling = {
  mode?: string | null;
  plan_id?: string | null;
  status?: string | null;
  trial_active?: boolean | null;
  trial_ends_at?: string | null;
  credit_balance_cents?: number | null;
  byo_entitled?: boolean | null;
  auto_topup_enabled?: boolean | null;
  auto_topup_threshold_cents?: number | null;
  auto_topup_pack_id?: string | null;
};

type CustomerProfile = {
  name: string;
  email: string;
  company: string;
  phone: string;
  country: string;
  vatId: string;
  addressLine1: string;
  city: string;
  postalCode: string;
};

type UiStatus = {
  tone: 'info' | 'success' | 'error';
  message: string;
};

type SessionContext = {
  token: string;
  authUser: {
    id: string;
    email?: string;
    user_metadata?: Record<string, any>;
  };
};

type ByokKeyRow = {
  provider: string;
  key_mask?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
};

type ByokLimitState = {
  dailyCapUsd: number;
  hardStopEnabled: boolean;
  updatedAt?: string | null;
};

type ByokUsageState = {
  usageTodayUsd: number;
  remainingUsd: number | null;
  dayStartUtc?: string | null;
};

const SUBSCRIPTION_PLANS: StripeCatalogItem[] = [
  STRIPE_PLANS.LITE,
  STRIPE_PLANS.STARTER,
  STRIPE_PLANS.PRO,
  STRIPE_PLANS.STUDIO,
  STRIPE_PLANS.BYOK,
];

const CREDIT_PACKS: StripeCatalogItem[] = [
  CREDIT_PACKAGES.CREDITS_1000,
  CREDIT_PACKAGES.CREDITS_2500,
  CREDIT_PACKAGES.CREDITS_5000,
  CREDIT_PACKAGES.CREDITS_10000,
];

const PLAN_COPY: Record<string, { label: string; cta: string; bullets: string[]; featured?: boolean }> = {
  lite: {
    label: 'Ideal fuer den Start',
    cta: 'Lite starten',
    bullets: ['Niedrige Grundgebuehr', 'Credits nach Verbrauch', 'Volle Produktfunktionen'],
  },
  starter: {
    label: 'Beliebt fuer kleine Teams',
    cta: 'Starter buchen',
    bullets: ['Monatliche Credits enthalten', 'Geeignet fuer regelmaessige Produktionen', 'Planbar fuer kleinere Workloads'],
  },
  pro: {
    label: 'Fuer Wachstum und Agenturen',
    cta: 'Pro buchen',
    bullets: ['Mehr inklusive Credits', 'Besser fuer mehrere Projekte', 'Hohes Output-Volumen'],
    featured: true,
  },
  studio: {
    label: 'Fuer intensive Produktion',
    cta: 'Studio buchen',
    bullets: ['Maximales Monatskontingent', 'Skalierung fuer Teams', 'Priorisiert fuer Dauerbetrieb'],
  },
  byo: {
    label: 'Einmalig, mit eigenen API Keys',
    cta: 'BYOK kaufen',
    bullets: ['Einmalzahlung', 'Eigene Provider-Keys', 'Volle Kostenkontrolle beim Provider'],
  },
};

const MODE_LABEL: Record<string, string> = {
  trial: 'Trial',
  byo: 'BYOK',
  hosted_lite: 'Hosted Lite',
  hosted_plan: 'Hosted Plan',
  credit_pack: 'Credit Pack',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Past due',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
};

const BYOK_PROVIDERS: Array<{ id: string; label: string; helper: string }> = [
  { id: 'gemini', label: 'Google Gemini', helper: 'LLM, image and video generation via Google APIs' },
  { id: 'replicate', label: 'Replicate', helper: 'Image/video/audio model routing on Replicate' },
  { id: 'fal', label: 'FAL', helper: 'Queue and realtime model endpoints on FAL' },
  { id: 'xai', label: 'xAI', helper: 'Grok image/video APIs' },
  { id: 'elevenlabs', label: 'ElevenLabs', helper: 'Text-to-speech and voices' },
  { id: 'worldlabs', label: 'World Labs', helper: '3D world generation APIs' },
];

const moneyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const formatEur = (value: number) => moneyFormatter.format(value);
const formatUsd = (value?: number | null) => {
  if (typeof value !== 'number') return '—';
  return usdFormatter.format(value);
};

const formatCents = (value?: number | null) => {
  if (typeof value !== 'number') return '€0.00';
  return formatEur(value / 100);
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
};

const readHashQuery = () => {
  const raw = window.location.hash || '#/billing';
  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
  const [path, query = ''] = withoutHash.split('?');
  return { path, params: new URLSearchParams(query) };
};

const defaultProfileFromUser = (user: ReturnType<typeof getCurrentUser>): CustomerProfile => ({
  name: user?.name || '',
  email: user?.email || '',
  company: '',
  phone: '',
  country: '',
  vatId: '',
  addressLine1: '',
  city: '',
  postalCode: '',
});

const coerceProfile = (
  raw: any,
  fallback: CustomerProfile,
): CustomerProfile => ({
  name: raw?.name || fallback.name,
  email: raw?.email || fallback.email,
  company: raw?.company || fallback.company,
  phone: raw?.phone || fallback.phone,
  country: raw?.country || fallback.country,
  vatId: raw?.vat_id || raw?.vatId || fallback.vatId,
  addressLine1: raw?.address_line1 || raw?.addressLine1 || fallback.addressLine1,
  city: raw?.city || fallback.city,
  postalCode: raw?.postal_code || raw?.postalCode || fallback.postalCode,
});

export const Billing: React.FC = () => {
  const user = getCurrentUser();
  const [status, setStatus] = React.useState<UiStatus | null>(null);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [account, setAccount] = React.useState<BillingAccount | null>(null);
  const [teamBilling, setTeamBilling] = React.useState<TeamBilling | null>(null);
  const [teamId, setTeamId] = React.useState<string | null>(user?.teamId || null);
  const [customerProfile, setCustomerProfile] = React.useState<CustomerProfile>(() => defaultProfileFromUser(user));
  const [autoTopupEnabled, setAutoTopupEnabled] = React.useState(false);
  const [autoTopupThreshold, setAutoTopupThreshold] = React.useState(1000);
  const [autoTopupPack, setAutoTopupPack] = React.useState('credits-1000');
  const [byokKeys, setByokKeys] = React.useState<ByokKeyRow[]>([]);
  const [byokDrafts, setByokDrafts] = React.useState<Record<string, string>>({});
  const [byokLimit, setByokLimit] = React.useState<ByokLimitState>({ dailyCapUsd: 25, hardStopEnabled: true });
  const [byokUsage, setByokUsage] = React.useState<ByokUsageState>({ usageTodayUsd: 0, remainingUsd: null });

  const showStatus = React.useCallback((tone: UiStatus['tone'], message: string) => {
    setStatus({ tone, message });
  }, []);

  const getSessionContext = React.useCallback(async (): Promise<SessionContext | null> => {
    const client = getSupabase();
    if (!client) {
      showStatus('error', 'Supabase ist nicht konfiguriert.');
      return null;
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      showStatus('error', 'Bitte neu einloggen, Session konnte nicht geladen werden.');
      return null;
    }
    return {
      token: data.session.access_token,
      authUser: data.session.user,
    };
  }, [showStatus]);

  const ensureTeamId = React.useCallback(async () => {
    if (teamId) return teamId;
    const session = await getSessionContext();
    if (!session) return null;

    setBusyAction('bootstrap');
    try {
      const response = await fetch('/api/billing/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          email: session.authUser.email,
          name: session.authUser.user_metadata?.name || session.authUser.user_metadata?.full_name,
        }),
      });

      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok || !payload?.teamId) {
        showStatus('error', payload?.error || 'Team konnte fuer Billing nicht initialisiert werden.');
        return null;
      }

      setTeamId(payload.teamId);
      patchCurrentUser({ teamId: payload.teamId });
      if (payload.billing) {
        setTeamBilling(payload.billing);
        setAutoTopupEnabled(Boolean(payload.billing.auto_topup_enabled));
        setAutoTopupThreshold(payload.billing.auto_topup_threshold_cents ?? 1000);
        setAutoTopupPack(payload.billing.auto_topup_pack_id ?? 'credits-1000');
      }
      return payload.teamId as string;
    } finally {
      setBusyAction((current) => (current === 'bootstrap' ? null : current));
    }
  }, [getSessionContext, showStatus, teamId]);

  const loadCustomerProfile = React.useCallback(
    async (resolvedTeamId: string, token: string, fallbackProfile: CustomerProfile) => {
      const response = await fetch(`/api/billing/customer?teamId=${encodeURIComponent(resolvedTeamId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        showStatus('error', payload?.error || 'Kundendaten konnten nicht geladen werden.');
        return;
      }
      setCustomerProfile(coerceProfile(payload?.profile, fallbackProfile));
      if (payload?.stripeCustomerId) {
        setAccount((current) => ({
          ...(current || {}),
          stripe_customer_id: payload.stripeCustomerId,
        }));
      }
    },
    [showStatus],
  );

  const loadByokData = React.useCallback(
    async (resolvedTeamId: string, token: string) => {
      const [keysResponse, limitsResponse] = await Promise.all([
        fetch(`/api/byok/keys?teamId=${encodeURIComponent(resolvedTeamId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/byok/limits?teamId=${encodeURIComponent(resolvedTeamId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const keysPayload = await keysResponse.json().catch(() => ({} as any));
      if (!keysResponse.ok) {
        showStatus('error', keysPayload?.error || 'BYOK keys konnten nicht geladen werden.');
      } else {
        setByokKeys(Array.isArray(keysPayload?.keys) ? keysPayload.keys as ByokKeyRow[] : []);
      }

      const limitsPayload = await limitsResponse.json().catch(() => ({} as any));
      if (!limitsResponse.ok) {
        showStatus('error', limitsPayload?.error || 'BYOK limits konnten nicht geladen werden.');
      } else {
        setByokLimit({
          dailyCapUsd: Number(limitsPayload?.limit?.dailyCapUsd) || 0,
          hardStopEnabled: Boolean(limitsPayload?.limit?.hardStopEnabled),
          updatedAt: limitsPayload?.limit?.updatedAt || null,
        });
        setByokUsage({
          usageTodayUsd: Number(limitsPayload?.usage?.usageTodayUsd) || 0,
          remainingUsd:
            typeof limitsPayload?.usage?.remainingUsd === 'number'
              ? Number(limitsPayload.usage.remainingUsd)
              : null,
          dayStartUtc: limitsPayload?.usage?.dayStartUtc || null,
        });
      }
    },
    [showStatus],
  );

  const loadAccount = React.useCallback(async () => {
    setBusyAction('refresh');
    try {
      const session = await getSessionContext();
      if (!session) return;
      const client = getSupabase();
      if (!client) return;

      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;

      const [accountResult, billingResult] = await Promise.all([
        client
          .from('billing_accounts')
          .select('status, price_id, stripe_customer_id, current_period_end, cancel_at_period_end')
          .eq('team_id', resolvedTeamId)
          .maybeSingle(),
        client
          .from('team_billing' as any)
          .select('mode, plan_id, status, trial_active, trial_ends_at, credit_balance_cents, byo_entitled, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_pack_id')
          .eq('team_id', resolvedTeamId)
          .maybeSingle(),
      ]);

      if (accountResult.error) {
        showStatus('error', accountResult.error.message);
      } else {
        setAccount((accountResult.data || null) as BillingAccount | null);
      }

      if (billingResult.error) {
        showStatus('error', billingResult.error.message);
      } else {
        const safeBilling = (billingResult.data || null) as TeamBilling | null;
        setTeamBilling(safeBilling);
        setAutoTopupEnabled(Boolean(safeBilling?.auto_topup_enabled));
        setAutoTopupThreshold(safeBilling?.auto_topup_threshold_cents ?? 1000);
        setAutoTopupPack(safeBilling?.auto_topup_pack_id ?? 'credits-1000');
      }

      const fallbackProfile = coerceProfile({
        name: session.authUser.user_metadata?.name || session.authUser.user_metadata?.full_name,
        email: session.authUser.email,
      }, defaultProfileFromUser(user));
      await loadCustomerProfile(resolvedTeamId, session.token, fallbackProfile);
      await loadByokData(resolvedTeamId, session.token);
    } finally {
      setBusyAction((current) => (current === 'refresh' ? null : current));
    }
  }, [ensureTeamId, getSessionContext, loadByokData, loadCustomerProfile, showStatus, teamId, user]);

  React.useEffect(() => {
    const { path, params } = readHashQuery();
    let changed = false;
    if (params.get('success') === '1') {
      showStatus('success', 'Checkout erfolgreich gestartet. Abo/Payment wurde in Stripe verarbeitet.');
      params.delete('success');
      changed = true;
    }
    if (params.get('canceled') === '1') {
      showStatus('info', 'Checkout wurde abgebrochen.');
      params.delete('canceled');
      changed = true;
    }
    if (changed) {
      const nextQuery = params.toString();
      const nextHash = `${path}${nextQuery ? `?${nextQuery}` : ''}`;
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#${nextHash}`);
    }
  }, [showStatus]);

  React.useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const updateProfile = (key: keyof CustomerProfile, value: string) => {
    setCustomerProfile((current) => ({ ...current, [key]: value }));
  };

  const handleCheckout = async (planKey: string) => {
    const busyKey = `checkout-${planKey}`;
    setBusyAction(busyKey);
    try {
      const session = await getSessionContext();
      if (!session) return;
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;
      showStatus('info', 'Stripe Checkout wird gestartet...');

      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          teamId: resolvedTeamId,
          planKey,
          email: customerProfile.email || session.authUser.email,
          name: customerProfile.name,
          phone: customerProfile.phone,
          company: customerProfile.company,
          vatId: customerProfile.vatId,
          country: customerProfile.country,
          addressLine1: customerProfile.addressLine1,
          city: customerProfile.city,
          postalCode: customerProfile.postalCode,
          successUrl: `${window.location.origin}/portal.html#/billing?success=1`,
          cancelUrl: `${window.location.origin}/portal.html#/billing?canceled=1`,
        }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      showStatus('error', data?.error || 'Checkout konnte nicht gestartet werden.');
    } finally {
      setBusyAction((current) => (current === busyKey ? null : current));
    }
  };

  const handlePortal = async () => {
    setBusyAction('portal');
    try {
      const session = await getSessionContext();
      if (!session) return;
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;

      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          teamId: resolvedTeamId,
          returnUrl: `${window.location.origin}/portal.html#/billing`,
        }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      showStatus('error', data?.error || 'Stripe Billing Portal konnte nicht geoeffnet werden.');
    } finally {
      setBusyAction((current) => (current === 'portal' ? null : current));
    }
  };

  const handleSaveAutoTopup = async () => {
    setBusyAction('save-topup');
    try {
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;
      const client = getSupabase();
      if (!client) {
        showStatus('error', 'Supabase ist nicht konfiguriert.');
        return;
      }
      const { error } = await client
        .from('team_billing')
        .upsert({
          team_id: resolvedTeamId,
          mode: teamBilling?.mode || 'hosted_lite',
          plan_id: teamBilling?.plan_id || null,
          auto_topup_enabled: autoTopupEnabled,
          auto_topup_threshold_cents: autoTopupThreshold,
          auto_topup_pack_id: autoTopupPack,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'team_id' });

      if (error) {
        showStatus('error', error.message);
        return;
      }
      showStatus('success', 'Auto Top-up wurde gespeichert.');
      await loadAccount();
    } finally {
      setBusyAction((current) => (current === 'save-topup' ? null : current));
    }
  };

  const handleSaveCustomer = async () => {
    setBusyAction('save-customer');
    try {
      const session = await getSessionContext();
      if (!session) return;
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;

      const response = await fetch('/api/billing/customer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          teamId: resolvedTeamId,
          ...customerProfile,
        }),
      });
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        showStatus('error', payload?.error || 'Kundendaten konnten nicht gespeichert werden.');
        return;
      }
      setCustomerProfile(coerceProfile(payload?.profile, customerProfile));
      if (payload?.stripeCustomerId) {
        setAccount((current) => ({ ...(current || {}), stripe_customer_id: payload.stripeCustomerId }));
      }
      showStatus('success', 'Kundendaten gespeichert und mit Stripe synchronisiert.');
    } finally {
      setBusyAction((current) => (current === 'save-customer' ? null : current));
    }
  };

  const updateByokDraft = (provider: string, value: string) => {
    setByokDrafts((current) => ({ ...current, [provider]: value }));
  };

  const handleSaveByokKey = async (provider: string) => {
    const busyKey = `save-byok-key-${provider}`;
    setBusyAction(busyKey);
    try {
      const draft = (byokDrafts[provider] || '').trim();
      if (!draft) {
        showStatus('error', `Bitte API-Key fuer ${provider} eintragen.`);
        return;
      }
      const session = await getSessionContext();
      if (!session) return;
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;

      const response = await fetch('/api/byok/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          teamId: resolvedTeamId,
          provider,
          apiKey: draft,
        }),
      });
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        showStatus('error', payload?.error || `BYOK key fuer ${provider} konnte nicht gespeichert werden.`);
        return;
      }

      setByokDrafts((current) => ({ ...current, [provider]: '' }));
      await loadByokData(resolvedTeamId, session.token);
      showStatus('success', `${provider} key wurde sicher im Vault gespeichert.`);
    } finally {
      setBusyAction((current) => (current === busyKey ? null : current));
    }
  };

  const handleRemoveByokKey = async (provider: string) => {
    const busyKey = `remove-byok-key-${provider}`;
    setBusyAction(busyKey);
    try {
      const session = await getSessionContext();
      if (!session) return;
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;

      const response = await fetch('/api/byok/keys', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          teamId: resolvedTeamId,
          provider,
        }),
      });
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        showStatus('error', payload?.error || `BYOK key fuer ${provider} konnte nicht entfernt werden.`);
        return;
      }

      await loadByokData(resolvedTeamId, session.token);
      showStatus('success', `${provider} key wurde entfernt.`);
    } finally {
      setBusyAction((current) => (current === busyKey ? null : current));
    }
  };

  const handleSaveByokLimit = async () => {
    const busyKey = 'save-byok-limit';
    setBusyAction(busyKey);
    try {
      const session = await getSessionContext();
      if (!session) return;
      const resolvedTeamId = teamId || await ensureTeamId();
      if (!resolvedTeamId) return;

      const response = await fetch('/api/byok/limits', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          teamId: resolvedTeamId,
          dailyCapUsd: Number.isFinite(byokLimit.dailyCapUsd) ? byokLimit.dailyCapUsd : 0,
          hardStopEnabled: byokLimit.hardStopEnabled,
        }),
      });
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        showStatus('error', payload?.error || 'BYOK daily cap konnte nicht gespeichert werden.');
        return;
      }

      setByokLimit({
        dailyCapUsd: Number(payload?.limit?.dailyCapUsd) || 0,
        hardStopEnabled: Boolean(payload?.limit?.hardStopEnabled),
        updatedAt: payload?.limit?.updatedAt || null,
      });
      setByokUsage({
        usageTodayUsd: Number(payload?.usage?.usageTodayUsd) || 0,
        remainingUsd:
          typeof payload?.usage?.remainingUsd === 'number' ? Number(payload.usage.remainingUsd) : null,
        dayStartUtc: payload?.usage?.dayStartUtc || null,
      });
      showStatus('success', 'BYOK daily spend limit gespeichert.');
    } finally {
      setBusyAction((current) => (current === busyKey ? null : current));
    }
  };

  const activePlanFromPrice = getCatalogItemByPriceId(account?.price_id || '');
  const activePlanId = teamBilling?.plan_id || activePlanFromPrice?.id || null;
  const activePlanLabel = activePlanId
    ? (SUBSCRIPTION_PLANS.find((item) => item.id === activePlanId)?.name || activePlanId)
    : (teamBilling?.mode ? MODE_LABEL[teamBilling.mode] || teamBilling.mode : 'No active plan');
  const billingStatus = account?.status || teamBilling?.status || (teamBilling?.trial_active ? 'trialing' : null);
  const isByoEntitled = Boolean(teamBilling?.byo_entitled);
  const canOpenPortal = Boolean(account?.stripe_customer_id);
  const byokKeyByProvider = React.useMemo(() => {
    const map = new Map<string, ByokKeyRow>();
    byokKeys.forEach((row) => map.set(row.provider, row));
    return map;
  }, [byokKeys]);

  return (
    <div className="panel billing-page">
      <div className="billing-head">
        <div>
          <h2>Billing & Subscriptions</h2>
          <p className="billing-subtitle">
            Schließe Abos direkt in Stripe ab, verwalte Credits und speichere saubere Kundendaten fuer Rechnungen.
          </p>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={loadAccount}
            disabled={busyAction !== null}
          >
            {busyAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="button primary"
            onClick={handlePortal}
            disabled={!canOpenPortal || busyAction === 'portal'}
          >
            {busyAction === 'portal' ? 'Opening...' : 'Manage in Stripe'}
          </button>
        </div>
      </div>

      <div className="billing-kpi-grid">
        <div className="billing-kpi">
          <span className="billing-kpi-label">Active plan</span>
          <strong>{activePlanLabel}</strong>
          <span>{teamBilling?.mode ? (MODE_LABEL[teamBilling.mode] || teamBilling.mode) : '—'}</span>
        </div>
        <div className="billing-kpi">
          <span className="billing-kpi-label">Billing status</span>
          <strong>{billingStatus ? (STATUS_LABEL[billingStatus] || billingStatus) : 'No billing account'}</strong>
          <span>{account?.cancel_at_period_end ? 'Cancels at period end' : 'Auto-renew enabled'}</span>
        </div>
        <div className="billing-kpi">
          <span className="billing-kpi-label">Credit balance</span>
          <strong>{formatCents(teamBilling?.credit_balance_cents)}</strong>
          <span>Top-up and subscriptions update this balance automatically.</span>
        </div>
        <div className="billing-kpi">
          <span className="billing-kpi-label">Current period end</span>
          <strong>{formatDate(account?.current_period_end || teamBilling?.trial_ends_at)}</strong>
          <span>{teamBilling?.trial_active ? 'Trial currently active' : 'Paid period date from Stripe'}</span>
        </div>
      </div>

      {status && (
        <div className={`billing-alert billing-alert-${status.tone}`}>
          {status.message}
        </div>
      )}

      <section className="billing-section">
        <div className="billing-section-head">
          <h3>Choose your subscription</h3>
          <p>Alle Planaktionen gehen direkt ueber Stripe Checkout. Danach kannst du alles im Portal verwalten.</p>
        </div>
        <div className="billing-plan-grid">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const copy = PLAN_COPY[plan.id] || {
              label: 'Subscription plan',
              cta: 'Choose plan',
              bullets: [],
            };
            const isActive = activePlanId === plan.id || (plan.id === 'byo' && isByoEntitled);
            const disabled = (busyAction !== null && busyAction !== `checkout-${plan.id}`) || isActive;
            return (
              <article
                key={plan.id}
                className={`billing-plan-card${copy.featured ? ' is-featured' : ''}${isActive ? ' is-active' : ''}`}
              >
                <div className="billing-plan-top">
                  <h4>{plan.name}</h4>
                  <span className="billing-plan-badge">{copy.label}</span>
                </div>
                <div className="billing-price">
                  {formatEur(plan.price)} {plan.interval === 'month' ? '/ Monat' : 'einmalig'}
                </div>
                {plan.includedCreditsCents > 0 && (
                  <div className="billing-included-credits">
                    Enthaltene Credits: {formatCents(plan.includedCreditsCents)}
                  </div>
                )}
                <ul className="billing-list">
                  {copy.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
                <div className="button-row">
                  <button
                    className={`button ${copy.featured ? 'primary' : 'secondary'}`}
                    onClick={() => handleCheckout(plan.id)}
                    disabled={disabled}
                  >
                    {isActive ? 'Aktiv' : busyAction === `checkout-${plan.id}` ? 'Redirecting...' : copy.cta}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="billing-section">
        <div className="billing-section-head">
          <h3>Credit packs & Auto Top-up</h3>
          <p>Kaufe Credits on-demand oder halte dein Guthaben automatisch ueber einem Schwellwert.</p>
        </div>
        <div className="billing-pack-grid">
          {CREDIT_PACKS.map((pack) => (
            <article className="billing-pack-card" key={pack.id}>
              <h4>{pack.name}</h4>
              <div className="billing-price">{formatEur(pack.price)}</div>
              <p>Fuegt {formatCents(pack.includedCreditsCents)} zum Team-Guthaben hinzu.</p>
              <button
                className="button secondary"
                onClick={() => handleCheckout(pack.id)}
                disabled={busyAction !== null && busyAction !== `checkout-${pack.id}`}
              >
                {busyAction === `checkout-${pack.id}` ? 'Redirecting...' : 'Buy credits'}
              </button>
            </article>
          ))}
        </div>

        <div className="billing-settings-grid">
          <div className="card">
            <h4>Auto Top-up</h4>
            <p>Automatischer Kauf eines Credit-Packs, sobald dein Guthaben unter den Schwellwert faellt.</p>
            <div className="field">
              <label>Enable auto top-up</label>
              <select
                value={autoTopupEnabled ? 'yes' : 'no'}
                onChange={(event) => setAutoTopupEnabled(event.target.value === 'yes')}
              >
                <option value="no">Disabled</option>
                <option value="yes">Enabled</option>
              </select>
            </div>
            <div className="field">
              <label>Threshold</label>
              <select
                value={autoTopupThreshold}
                onChange={(event) => setAutoTopupThreshold(Number(event.target.value))}
              >
                <option value={500}>5€</option>
                <option value={1000}>10€</option>
                <option value={2000}>20€</option>
              </select>
            </div>
            <div className="field">
              <label>Top-up pack</label>
              <select value={autoTopupPack} onChange={(event) => setAutoTopupPack(event.target.value)}>
                {CREDIT_PACKS.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="button primary"
              onClick={handleSaveAutoTopup}
              disabled={busyAction === 'save-topup'}
            >
              {busyAction === 'save-topup' ? 'Saving...' : 'Save auto top-up'}
            </button>
          </div>

          <div className="card">
            <h4>Subscription service</h4>
            <p>Rechnungen, Zahlungsarten, Kuendigungen und Upgrades erfolgen direkt im Stripe Customer Portal.</p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={handlePortal}
                disabled={!canOpenPortal || busyAction === 'portal'}
              >
                {busyAction === 'portal' ? 'Opening...' : 'Open billing portal'}
              </button>
              <button
                className="button secondary"
                onClick={handlePortal}
                disabled={!canOpenPortal || busyAction === 'portal'}
              >
                View invoices
              </button>
            </div>
            <p className="billing-helper-text">
              Falls noch kein Stripe-Kunde existiert, speichere zuerst die Kundendaten unten.
            </p>
          </div>
        </div>
      </section>

      <section className="billing-section">
        <div className="billing-section-head">
          <h3>BYOK Vault & Guardrails</h3>
          <p>
            Provider-Keys liegen verschluesselt serverseitig. Daily Caps stoppen neue Requests hart, bevor Kosten entgleisen.
          </p>
        </div>
        <div className="billing-settings-grid">
          <div className="card">
            <h4>Provider keys</h4>
            <p>Setze hier Team-Keys fuer die Web-App. Im Browser wird nur ein maskierter Status angezeigt.</p>
            <div className="byok-provider-list">
              {BYOK_PROVIDERS.map((provider) => {
                const saved = byokKeyByProvider.get(provider.id);
                const saveBusy = busyAction === `save-byok-key-${provider.id}`;
                const removeBusy = busyAction === `remove-byok-key-${provider.id}`;
                return (
                  <article className="byok-provider-item" key={provider.id}>
                    <div className="byok-provider-head">
                      <div>
                        <strong>{provider.label}</strong>
                        <span>{provider.helper}</span>
                      </div>
                      <span className={`byok-status-chip ${saved ? 'ok' : 'warn'}`}>
                        {saved?.key_mask ? saved.key_mask : 'Not set'}
                      </span>
                    </div>
                    <div className="field">
                      <label>{provider.label} key</label>
                      <input
                        type="password"
                        value={byokDrafts[provider.id] || ''}
                        onChange={(event) => updateByokDraft(provider.id, event.target.value)}
                        placeholder={saved?.key_mask ? 'Paste new key to rotate' : 'Paste API key'}
                      />
                    </div>
                    <div className="button-row">
                      <button
                        className="button primary"
                        onClick={() => handleSaveByokKey(provider.id)}
                        disabled={saveBusy || removeBusy || !(byokDrafts[provider.id] || '').trim()}
                      >
                        {saveBusy ? 'Saving...' : 'Save key'}
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => handleRemoveByokKey(provider.id)}
                        disabled={removeBusy || saveBusy || !saved}
                      >
                        {removeBusy ? 'Removing...' : 'Remove key'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h4>Daily spend limit (USD)</h4>
            <p>Wenn Hard Stop aktiv ist, blockiert die API neue billable Requests nach Erreichen des Tageslimits.</p>
            <div className="byok-usage-grid">
              <div>
                <span>Usage today</span>
                <strong>{formatUsd(byokUsage.usageTodayUsd)}</strong>
              </div>
              <div>
                <span>Remaining</span>
                <strong>{byokUsage.remainingUsd === null ? 'Unlimited' : formatUsd(byokUsage.remainingUsd)}</strong>
              </div>
              <div>
                <span>Updated</span>
                <strong>{formatDate(byokLimit.updatedAt || null)}</strong>
              </div>
            </div>
            <div className="field">
              <label>Daily cap (USD)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={Number.isFinite(byokLimit.dailyCapUsd) ? byokLimit.dailyCapUsd : 0}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setByokLimit((current) => ({
                    ...current,
                    dailyCapUsd: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                  }));
                }}
              />
            </div>
            <div className="field">
              <label>Hard stop</label>
              <select
                value={byokLimit.hardStopEnabled ? 'on' : 'off'}
                onChange={(event) => {
                  setByokLimit((current) => ({
                    ...current,
                    hardStopEnabled: event.target.value === 'on',
                  }));
                }}
              >
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </div>
            <button
              className="button primary"
              onClick={handleSaveByokLimit}
              disabled={busyAction === 'save-byok-limit'}
            >
              {busyAction === 'save-byok-limit' ? 'Saving...' : 'Save BYOK limit'}
            </button>
            <p className="billing-helper-text">
              Empfehlung: Hard Stop eingeschaltet lassen und nur ein Tagesbudget setzen, das du bewusst riskieren willst.
            </p>
          </div>
        </div>
      </section>

      <section className="billing-section">
        <div className="billing-section-head">
          <h3>Customer data</h3>
          <p>Diese Daten werden teamweit gespeichert und fuer Stripe/Rechnungsdaten verwendet.</p>
        </div>
        <div className="billing-profile-grid">
          <div className="field">
            <label>Full name</label>
            <input
              value={customerProfile.name}
              onChange={(event) => updateProfile('name', event.target.value)}
              placeholder="Ludwig Kienle"
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={customerProfile.email}
              onChange={(event) => updateProfile('email', event.target.value)}
              placeholder="billing@company.com"
            />
          </div>
          <div className="field">
            <label>Company</label>
            <input
              value={customerProfile.company}
              onChange={(event) => updateProfile('company', event.target.value)}
              placeholder="AI Video Production Editor"
            />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={customerProfile.phone}
              onChange={(event) => updateProfile('phone', event.target.value)}
              placeholder="+49..."
            />
          </div>
          <div className="field">
            <label>Country code</label>
            <input
              value={customerProfile.country}
              onChange={(event) => updateProfile('country', event.target.value.toUpperCase())}
              placeholder="DE"
              maxLength={2}
            />
          </div>
          <div className="field">
            <label>VAT ID</label>
            <input
              value={customerProfile.vatId}
              onChange={(event) => updateProfile('vatId', event.target.value)}
              placeholder="DE123456789"
            />
          </div>
          <div className="field billing-field-wide">
            <label>Address line 1</label>
            <input
              value={customerProfile.addressLine1}
              onChange={(event) => updateProfile('addressLine1', event.target.value)}
              placeholder="Street and number"
            />
          </div>
          <div className="field">
            <label>City</label>
            <input
              value={customerProfile.city}
              onChange={(event) => updateProfile('city', event.target.value)}
              placeholder="Berlin"
            />
          </div>
          <div className="field">
            <label>Postal code</label>
            <input
              value={customerProfile.postalCode}
              onChange={(event) => updateProfile('postalCode', event.target.value)}
              placeholder="10115"
            />
          </div>
        </div>
        <div className="button-row">
          <button
            className="button primary"
            onClick={handleSaveCustomer}
            disabled={busyAction === 'save-customer'}
          >
            {busyAction === 'save-customer' ? 'Saving...' : 'Save customer data'}
          </button>
          {account?.stripe_customer_id && (
            <span className="billing-helper-text">Stripe customer: {account.stripe_customer_id}</span>
          )}
        </div>
      </section>
    </div>
  );
};
