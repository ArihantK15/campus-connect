const API_BASE = '/api';
const SESSION_KEY = 'cc-auth-session';

class CampusConnectAPI {
  constructor() {
    this.supabaseUrl = null;
    this.publishableKey = null;
    this.session = null;
    this.refreshing = null;
    this.storageAvailable = true;
    this.initialError = null;
  }

  async initialize() {
    const configResponse = await fetch(`${API_BASE}/config`);
    const config = await this.parseResponse(configResponse);
    if (!configResponse.ok || !config?.supabase_url || !config?.publishable_key) {
      throw new Error(config?.error || 'Supabase is not configured.');
    }
    this.supabaseUrl = config.supabase_url.replace(/\/+$/, '');
    this.publishableKey = config.publishable_key;
    try {
      this.session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (error) {
      console.error('Could not restore the Supabase session:', error);
      this.clearSession();
    }
    await this.completeAuthRedirect();
  }

  async parseResponse(response) {
    const body = await response.text();
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`The server returned an invalid response (${response.status}).`);
    }
  }

  async requestAuth(endpoint, body, accessToken = null) {
    if (!this.supabaseUrl || !this.publishableKey) {
      throw new Error('Supabase authentication is not configured.');
    }
    const response = await fetch(`${this.supabaseUrl}/auth/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await this.parseResponse(response);
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || data?.error_description || `Authentication failed (${response.status}).`);
      error.status = response.status;
      error.code = data?.code || data?.error_code;
      throw error;
    }
    return data;
  }

  saveSession(response) {
    const session = response?.session || response;
    if (!session?.access_token || !session?.refresh_token) return null;
    const expiresIn = Number(session.expires_in) || 3600;
    this.session = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: Number(session.expires_at) || Math.floor(Date.now() / 1000) + expiresIn,
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      this.storageAvailable = true;
    } catch (error) {
      this.storageAvailable = false;
      console.warn('The Supabase session will not persist in browser storage:', error);
    }
    return session.user || response.user || null;
  }

  clearSession() {
    this.session = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      this.storageAvailable = true;
    } catch (error) {
      this.storageAvailable = false;
      console.warn('Could not clear the stored Supabase session:', error);
    }
  }

  async signUp(name, email, password) {
    this.clearSession();
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const data = await this.requestAuth(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
      email,
      password,
      data: { display_name: name },
    });
    const authUser = this.saveSession(data);
    return { user: authUser || data?.user || data, hasSession: Boolean(this.session) };
  }

  async signIn(email, password) {
    this.clearSession();
    const data = await this.requestAuth('token?grant_type=password', { email, password });
    const authUser = this.saveSession(data);
    if (!authUser || !this.session) {
      this.clearSession();
      throw new Error('Supabase did not return a sign-in session.');
    }
    return authUser;
  }

  async signOut() {
    const token = this.session?.access_token;
    try {
      if (token) await this.requestAuth('logout', undefined, token);
    } finally {
      this.clearSession();
    }
  }

  async completeAuthRedirect() {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const authError = query.get('error_description') || hash.get('error_description');
    const tokenHash = query.get('token_hash') || hash.get('token_hash');
    const type = query.get('type') || hash.get('type');
    try {
      if (authError) {
        this.initialError = authError;
      } else if (tokenHash && type) {
        const data = await this.requestAuth('verify', { token_hash: tokenHash, type });
        this.saveSession(data);
      } else if (hash.get('access_token') && hash.get('refresh_token')) {
        this.saveSession({
          access_token: hash.get('access_token'),
          refresh_token: hash.get('refresh_token'),
          expires_in: hash.get('expires_in'),
        });
      }
    } finally {
      if (authError || tokenHash || hash.has('access_token')) {
        for (const key of ['error', 'error_description', 'error_code', 'token_hash', 'type']) query.delete(key);
        for (const key of ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'error', 'error_description', 'error_code', 'token_hash', 'type']) hash.delete(key);
        const remainingHash = hash.toString();
        const nextUrl = `${window.location.pathname}${query.size ? `?${query}` : ''}${remainingHash ? `#${remainingHash}` : ''}`;
        window.history.replaceState(null, '', nextUrl);
      }
    }
  }

  async refreshSession(force = false) {
    if (!this.session?.refresh_token) {
      this.clearSession();
      throw new Error('Your session expired. Please sign in again.');
    }
    const expiresSoon = this.session.expires_at <= Math.floor(Date.now() / 1000) + 60;
    if (!force && !expiresSoon) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.requestAuth('token?grant_type=refresh_token', {
      refresh_token: this.session.refresh_token,
    }).then(data => {
      if (!this.saveSession(data)) throw new Error('Supabase did not return a refreshed session.');
    }).catch(error => {
      if (error.status === 400 || error.status === 401) this.clearSession();
      throw error;
    }).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async fetch(endpoint, options = {}) {
    const { auth, ...requestOptions } = options;
    if (auth) await this.refreshSession();
    const send = () => fetch(`${API_BASE}${endpoint}`, {
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        ...requestOptions.headers,
        ...(auth && this.session?.access_token ? { Authorization: `Bearer ${this.session.access_token}` } : {}),
      },
    });
    let response = await send();
    if (auth && response.status === 401 && this.session?.refresh_token) {
      await this.refreshSession(true);
      response = await send();
    }
    const data = await this.parseResponse(response);
    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  get hasSession() {
    return Boolean(this.session?.access_token);
  }

  async getEvents() {
    return this.fetch('/events');
  }

  async getEvent(eventId) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}`);
  }

  async getMe() {
    return this.fetch('/me', { auth: true });
  }

  async registerForEvent(eventId) {
    return this.fetch('/registrations', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId }),
      auth: true,
    });
  }

  async cancelRegistration(eventId) {
    return this.fetch(`/registrations/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      auth: true,
    });
  }

  async getMyRegistrations() {
    return this.fetch('/me/registrations', { auth: true });
  }

  async getEventRegistrations(eventId) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}/registrations`, { auth: true });
  }
}

const api = new CampusConnectAPI();
export default api;
