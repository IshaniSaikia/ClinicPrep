const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const { signal, headers, ...fetchOptions } = options;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...fetchOptions,
    signal,
    headers: {
      ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const fieldDetails = payload?.fields ? Object.values(payload.fields).join(' ') : '';
    const error = new Error(fieldDetails || payload?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = payload?.code;
    error.fallbackMessage = payload?.fallbackMessage;
    throw error;
  }
  return payload;
}

export async function getBackendHealth(signal) {
  const health = await request('/api/health', { signal });
  if (health.status !== 'ok' || health.service !== 'clinicprep-api' || !['mongodb', 'memory'].includes(health.storage)) {
    throw new Error('Unexpected backend health response.');
  }
  return health;
}

export async function getAppointments(signal) {
  const response = await request('/api/appointments', { signal });
  return response.appointments;
}

export function generateAppointmentDraft(appointment, signal) {
  return request('/api/drafts', { method: 'POST', body: JSON.stringify(appointment), signal });
}

export function getAppointment(id, signal) {
  return request(`/api/appointments/${encodeURIComponent(id)}`, { signal });
}

export function createAppointment(appointment, signal) {
  return request('/api/appointments', { method: 'POST', body: JSON.stringify(appointment), signal });
}

export function updateAppointment(id, appointment, signal) {
  return request(`/api/appointments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(appointment), signal });
}

export function deleteAppointment(id, signal) {
  return request(`/api/appointments/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
}
