// API client for Campus Connect - connects to Flask backend with Supabase
const API_BASE = '/api';

class CampusConnectAPI {
  constructor() {
    this.userEmail = null;
    this.userToken = null;
  }

  // Set user email for authenticated requests
  setUser(email) {
    this.userEmail = email;
  }

  // Get headers for authenticated requests
  getHeaders(includeAuth = false) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (includeAuth && this.userEmail) {
      headers['X-User-Email'] = this.userEmail;
    }
    return headers;
  }

  // Generic fetch wrapper
  async fetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const { auth, ...requestOptions } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: requestOptions.signal || controller.signal,
        headers: {
          ...this.getHeaders(auth),
          ...requestOptions.headers,
        },
      });
      const body = await response.text();
      let data = null;
      if (body) {
        try {
          data = JSON.parse(body);
        } catch {
          throw new Error(`The server returned an invalid response (${response.status}).`);
        }
      }
      if (!response.ok) {
        const error = new Error(data?.error || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The request timed out. Check your connection and try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Events
  async getEvents() {
    return this.fetch('/events');
  }

  async getEvent(eventId) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}`);
  }

  // Registrations
  async registerForEvent(eventId, email) {
    return this.fetch('/registrations', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, email }),
      auth: true,
    });
  }

  async cancelRegistration(eventId) {
    return this.fetch(`/registrations/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      auth: true,
    });
  }

  async getMyRegistrations(email = this.userEmail) {
    return this.fetch('/me/registrations', {
      auth: true,
      headers: email ? { 'X-User-Email': email } : {},
    });
  }

  async getEventRegistrations(eventId, organizerEmail = this.userEmail) {
    return this.fetch(`/events/${encodeURIComponent(eventId)}/registrations`, {
      auth: true,
      headers: organizerEmail ? { 'X-Organizer-Email': organizerEmail } : {},
    });
  }
}

// Export singleton instance
const api = new CampusConnectAPI();
export default api;