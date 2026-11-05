const API_BASE = '/api';
const USER_KEY = 'cc-current-user-id';

// Campus Connect has no sign-in. The chosen user's id is sent in X-User-Id and
// the server applies that user's role. The choice is remembered in this browser.
function communityPath(communityId) {
  const id = Number(communityId);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid community id.');
  return id;
}

class CampusConnectAPI {
  constructor() {
    this.userId = null;
  }

  restoreUser() {
    try {
      this.userId = localStorage.getItem(USER_KEY) || null;
    } catch {
      this.userId = null;
    }
    return this.userId;
  }

  setUser(userId) {
    this.userId = userId || null;
    try {
      if (this.userId) localStorage.setItem(USER_KEY, this.userId);
      else localStorage.removeItem(USER_KEY);
    } catch (error) {
      console.warn('The selected user will not be remembered:', error);
    }
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

  async fetch(endpoint, options = {}) {
    const { useUser = true, headers = {}, ...requestOptions } = options;
    const send = () => fetch(`${API_BASE}${endpoint}`, {
      cache: 'no-store',
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(useUser && this.userId ? { 'X-User-Id': this.userId } : {}),
      },
    });
    const response = await send();
    const data = await this.parseResponse(response);
    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  get hasUser() {
    return Boolean(this.userId);
  }

  // Identity
  async getUsers() {
    return this.fetch('/users', { useUser: false });
  }

  async getMe() {
    return this.fetch('/me');
  }

  // Events
  async getEvents() {
    return this.fetch('/events', { useUser: false });
  }

  async getEvent(eventId) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}`, { useUser: false });
  }

  async createEvent(eventData) {
    return this.fetch('/events', { method: 'POST', body: JSON.stringify(eventData) });
  }

  async updateEvent(eventId, eventData) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(eventData) });
  }

  async deleteEvent(eventId) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  async getMyEvents() {
    return this.fetch('/me/events');
  }

  async getEventRegistrationCount(eventId) {
    const result = await this.fetch(`/events/${encodeURIComponent(eventId)}/registrations?count_only=true`);
    if (typeof result?.count !== 'number') throw new Error('The registration count response was invalid.');
    return result.count;
  }

  async getEventRegistrations(eventId) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}/registrations`);
  }

  // Registrations
  async registerForEvent(eventId) {
    return this.fetch('/registrations', { method: 'POST', body: JSON.stringify({ event_id: eventId }) });
  }

  async cancelRegistration(eventId) {
    return this.fetch(`/registrations/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  async getMyRegistrations() {
    return this.fetch('/me/registrations');
  }

  // Saved events and communities
  async getSavedEventIds() {
    return this.fetch('/me/saved');
  }

  async saveEvent(eventId) {
    return this.fetch(`/me/saved/${encodeURIComponent(eventId)}`, { method: 'PUT' });
  }

  async unsaveEvent(eventId) {
    return this.fetch(`/me/saved/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  async getCommunities() {
    return this.fetch('/communities');
  }

  async joinCommunity(communityId) {
    return this.fetch(`/me/communities/${communityPath(communityId)}`, { method: 'PUT' });
  }

  async leaveCommunity(communityId) {
    return this.fetch(`/me/communities/${communityPath(communityId)}`, { method: 'DELETE' });
  }

  // Admin
  async getAdminStats() {
    return this.fetch('/admin/stats');
  }

  async getAdminUsers(page = 1, perPage = 20) {
    return this.fetch(`/admin/users?page=${page}&per_page=${perPage}`);
  }

  async updateAdminUser(userId, role) {
    return this.fetch(`/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) });
  }

  async deleteAdminUser(userId) {
    return this.fetch(`/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }

  async getAdminEvents(page = 1, perPage = 20) {
    return this.fetch(`/admin/events?page=${page}&per_page=${perPage}`);
  }

  async getAdminEvent(eventId) {
    return this.fetch(`/admin/events/${encodeURIComponent(eventId)}`);
  }

  async deleteAdminEvent(eventId) {
    return this.fetch(`/admin/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  async getAdminRegistrations(page = 1, perPage = 20) {
    return this.fetch(`/admin/registrations?page=${page}&per_page=${perPage}`);
  }
}

const api = new CampusConnectAPI();
export default api;
