const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const getSupabaseAdmin = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

const getStripeClient = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2023-10-16' });
};

const takeFirst = (value) => (Array.isArray(value) ? value[0] : value);

const getBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  const value = takeFirst(header);
  if (!value || typeof value !== 'string') return null;
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim();
};

const clean = (value, max = 255) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
};

const isMissingCustomerTable = (error) => {
  return error?.code === '42P01' || /customer_profiles/i.test(error?.message || '');
};

const authorizeTeamMember = async (supabase, req, teamId) => {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing authorization token' };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return { ok: false, status: 401, error: 'Invalid session token' };
  }

  const userId = authData.user.id;
  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberError) {
    return { ok: false, status: 500, error: memberError.message };
  }

  if (!member) {
    return { ok: false, status: 403, error: 'No access to this team' };
  }

  return {
    ok: true,
    token,
    user: authData.user,
    role: member.role,
  };
};

const buildStripeAddress = (profile) => {
  const country = clean(profile.country, 2)?.toUpperCase() || null;
  const line1 = clean(profile.addressLine1, 255);
  const city = clean(profile.city, 120);
  const postalCode = clean(profile.postalCode, 40);
  if (!country && !line1 && !city && !postalCode) return undefined;
  return {
    country: country || undefined,
    line1: line1 || undefined,
    city: city || undefined,
    postal_code: postalCode || undefined,
  };
};

module.exports = async (req, res) => {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase service role not configured' });
  }

  const method = req.method || 'GET';
  if (!['GET', 'POST'].includes(method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const teamId = clean(takeFirst(method === 'GET' ? req.query?.teamId : req.body?.teamId), 64);
  if (!teamId) {
    return res.status(400).json({ error: 'Missing teamId' });
  }

  const auth = await authorizeTeamMember(supabase, req, teamId);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (method === 'GET') {
    const { data: profile, error } = await supabase
      .from('customer_profiles')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle();

    if (error && !isMissingCustomerTable(error)) {
      return res.status(500).json({ error: error.message });
    }

    const { data: billingAccount } = await supabase
      .from('billing_accounts')
      .select('stripe_customer_id')
      .eq('team_id', teamId)
      .maybeSingle();

    return res.status(200).json({
      profile: profile || null,
      stripeCustomerId: billingAccount?.stripe_customer_id || null,
      hasProfileTable: !error || !isMissingCustomerTable(error),
    });
  }

  if (!['owner', 'admin'].includes(auth.role)) {
    return res.status(403).json({ error: 'Only owners/admins can edit billing customer data' });
  }

  const body = req.body || {};
  const profilePayload = {
    team_id: teamId,
    user_id: auth.user.id,
    name: clean(body.name, 160),
    email: clean(body.email, 200) || auth.user.email || null,
    company: clean(body.company, 200),
    phone: clean(body.phone, 60),
    country: clean(body.country, 2)?.toUpperCase() || null,
    vat_id: clean(body.vatId, 80),
    address_line1: clean(body.addressLine1, 255),
    city: clean(body.city, 120),
    postal_code: clean(body.postalCode, 40),
    updated_at: new Date().toISOString(),
  };

  let profileData = null;
  const { data: upsertedProfile, error: profileError } = await supabase
    .from('customer_profiles')
    .upsert(profilePayload, { onConflict: 'team_id' })
    .select('*')
    .maybeSingle();

  if (profileError && !isMissingCustomerTable(profileError)) {
    return res.status(500).json({ error: profileError.message });
  }
  profileData = upsertedProfile || profilePayload;

  const stripe = getStripeClient();
  const { data: billingAccount, error: billingAccountError } = await supabase
    .from('billing_accounts')
    .select('stripe_customer_id')
    .eq('team_id', teamId)
    .maybeSingle();

  if (billingAccountError) {
    return res.status(500).json({ error: billingAccountError.message });
  }

  let stripeCustomerId = billingAccount?.stripe_customer_id || null;
  const stripeAddress = buildStripeAddress(body);

  if (stripe) {
    const customerPayload = {
      email: profilePayload.email || undefined,
      name: profilePayload.name || undefined,
      phone: profilePayload.phone || undefined,
      address: stripeAddress,
      metadata: {
        teamId,
        userId: auth.user.id,
        company: profilePayload.company || '',
        vatId: profilePayload.vat_id || '',
      },
    };

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(customerPayload);
      stripeCustomerId = customer.id;
    } else {
      await stripe.customers.update(stripeCustomerId, customerPayload);
    }

    const { error: upsertAccountError } = await supabase
      .from('billing_accounts')
      .upsert({
        team_id: teamId,
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'team_id' });

    if (upsertAccountError) {
      return res.status(500).json({ error: upsertAccountError.message });
    }

    await supabase
      .from('customer_profiles')
      .update({
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq('team_id', teamId);
  }

  return res.status(200).json({
    ok: true,
    profile: {
      ...profileData,
      stripe_customer_id: stripeCustomerId || profileData?.stripe_customer_id || null,
    },
    stripeCustomerId,
  });
};
