export type CloudProvider = 'dropbox' | 'google-drive';

type CloudAuthPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  accountId?: string;
  updatedAt?: string;
};

type StoredClientConfig = {
  dropboxClientId?: string;
  googleDriveClientId?: string;
};

const STORAGE_KEYS = {
  clientConfig: 'cloud_client_config_v1',
  dropboxAuth: 'cloud_dropbox_auth_v1',
  googleAuth: 'cloud_google_auth_v1',
  oauthState: 'cloud_oauth_state_v1',
  oauthVerifier: 'cloud_oauth_verifier_v1',
  oauthProvider: 'cloud_oauth_provider_v1',
};

const getClientConfig = (): StoredClientConfig => {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(STORAGE_KEYS.clientConfig);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredClientConfig;
  } catch {
    return {};
  }
};

const saveClientConfig = (config: StoredClientConfig) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEYS.clientConfig, JSON.stringify(config));
};

export const getCloudClientId = (provider: CloudProvider) => {
  const config = getClientConfig();
  if (provider === 'dropbox') return config.dropboxClientId || '';
  return config.googleDriveClientId || '';
};

export const setCloudClientId = (provider: CloudProvider, value: string) => {
  const config = getClientConfig();
  if (provider === 'dropbox') {
    saveClientConfig({ ...config, dropboxClientId: value });
  } else {
    saveClientConfig({ ...config, googleDriveClientId: value });
  }
};

export const getCloudAuth = (provider: CloudProvider): CloudAuthPayload | null => {
  if (typeof window === 'undefined') return null;
  const key = provider === 'dropbox' ? STORAGE_KEYS.dropboxAuth : STORAGE_KEYS.googleAuth;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CloudAuthPayload;
  } catch {
    return null;
  }
};

export const setCloudAuth = (provider: CloudProvider, auth: CloudAuthPayload | null) => {
  if (typeof window === 'undefined') return;
  const key = provider === 'dropbox' ? STORAGE_KEYS.dropboxAuth : STORAGE_KEYS.googleAuth;
  if (!auth) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(auth));
};

export const clearCloudAuth = (provider: CloudProvider) => {
  setCloudAuth(provider, null);
};

const randomString = (length: number) => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => (x % 36).toString(36)).join('');
};

const base64UrlEncode = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256 = async (text: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
};

const buildRedirectUri = () => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
};

export const startCloudOAuth = async (provider: CloudProvider) => {
  const clientId = getCloudClientId(provider);
  if (!clientId) {
    throw new Error('Missing OAuth client ID.');
  }
  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  const state = randomString(32);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEYS.oauthState, state);
    window.localStorage.setItem(STORAGE_KEYS.oauthVerifier, verifier);
    window.localStorage.setItem(STORAGE_KEYS.oauthProvider, provider);
  }

  const redirectUri = buildRedirectUri();
  let authUrl = '';
  if (provider === 'dropbox') {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      token_access_type: 'offline',
    });
    authUrl = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  } else {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  window.location.assign(authUrl);
};

const exchangeDropboxToken = async (code: string, verifier: string, redirectUri: string) => {
  const clientId = getCloudClientId('dropbox');
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Dropbox OAuth failed: ${msg || response.statusText}`);
  }
  return response.json();
};

const exchangeGoogleToken = async (code: string, verifier: string, redirectUri: string) => {
  const clientId = getCloudClientId('google-drive');
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Google OAuth failed: ${msg || response.statusText}`);
  }
  return response.json();
};

const clearOAuthState = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEYS.oauthState);
  window.localStorage.removeItem(STORAGE_KEYS.oauthVerifier);
  window.localStorage.removeItem(STORAGE_KEYS.oauthProvider);
};

export const handleCloudOAuthCallback = async () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return false;
  const storedState = window.localStorage.getItem(STORAGE_KEYS.oauthState);
  const provider = window.localStorage.getItem(STORAGE_KEYS.oauthProvider) as CloudProvider | null;
  const verifier = window.localStorage.getItem(STORAGE_KEYS.oauthVerifier);
  if (!storedState || storedState !== state || !provider || !verifier) {
    clearOAuthState();
    throw new Error('OAuth state mismatch. Please try connecting again.');
  }

  const redirectUri = buildRedirectUri();
  if (provider === 'dropbox') {
    const payload = await exchangeDropboxToken(code, verifier, redirectUri);
    setCloudAuth('dropbox', {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
      tokenType: payload.token_type,
      accountId: payload.account_id,
      updatedAt: new Date().toISOString(),
    });
  } else {
    const payload = await exchangeGoogleToken(code, verifier, redirectUri);
    setCloudAuth('google-drive', {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
      tokenType: payload.token_type,
      scope: payload.scope,
      updatedAt: new Date().toISOString(),
    });
  }

  clearOAuthState();
  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
};

const refreshDropboxToken = async (auth: CloudAuthPayload) => {
  if (!auth.refreshToken) return auth;
  const clientId = getCloudClientId('dropbox');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: clientId,
  });
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    return auth;
  }
  const payload = await response.json();
  const next = {
    ...auth,
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
    tokenType: payload.token_type || auth.tokenType,
    updatedAt: new Date().toISOString(),
  };
  setCloudAuth('dropbox', next);
  return next;
};

const refreshGoogleToken = async (auth: CloudAuthPayload) => {
  if (!auth.refreshToken) return auth;
  const clientId = getCloudClientId('google-drive');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: clientId,
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    return auth;
  }
  const payload = await response.json();
  const next = {
    ...auth,
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
    tokenType: payload.token_type || auth.tokenType,
    updatedAt: new Date().toISOString(),
  };
  setCloudAuth('google-drive', next);
  return next;
};

export const getValidCloudAuth = async (provider: CloudProvider) => {
  const auth = getCloudAuth(provider);
  if (!auth?.accessToken) return null;
  if (!auth.expiresAt || auth.expiresAt > Date.now() + 60000) {
    return auth;
  }
  if (provider === 'dropbox') {
    return refreshDropboxToken(auth);
  }
  return refreshGoogleToken(auth);
};
