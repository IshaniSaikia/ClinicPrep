import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { MemoryAppointmentStore } from './appointment-store.js';
import { createGroqDraftService, GroqDraftError, GROQ_MODEL } from './groq-draft-service.js';

const APPOINTMENT_TYPES = new Set(['Primary care', 'Specialist', 'Dental', 'Mental health', 'Other']);
const FIELD_LIMITS = {
  concern: 1000,
  notes: 2000,
  medicines: 1000,
  allergies: 1000,
  questions: 1500,
  summary: 12000,
};

function validateAppointment(body, { allowId = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Send a JSON object containing the appointment fields.' } };
  }

  const errors = {};
  const values = {};
  const type = body.type ?? 'Primary care';
  if (typeof type !== 'string' || !APPOINTMENT_TYPES.has(type.trim())) {
    errors.type = 'Choose a valid appointment type.';
  } else {
    values.type = type.trim();
  }

  const date = body.date ?? '';
  if (typeof date !== 'string' || (date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date))) {
    errors.date = 'Enter a valid date in YYYY-MM-DD format, or leave it blank.';
  } else {
    values.date = date;
  }

  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = body[field] ?? '';
    if (typeof value !== 'string') {
      errors[field] = 'Enter text for this field.';
    } else if (value.length > limit) {
      errors[field] = `Use ${limit} characters or fewer.`;
    } else {
      values[field] = field === 'concern' ? value.trim() : value;
    }
  }

  if (!values.concern) {
    errors.concern = 'Main concern is required.';
  }

  if (allowId && body.id !== undefined) {
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.id)) {
      errors.id = 'Record ID must contain only letters, numbers, underscores, or hyphens (up to 80 characters).';
    } else {
      values.id = body.id;
    }
  }

  return Object.keys(errors).length ? { errors } : { values };
}

function sendValidationError(response, errors) {
  const details = Object.values(errors).join(' ');
  return response.status(400).json({ error: `Invalid appointment data. ${details}`, fields: errors });
}

export function createApp({ appointmentStore = new MemoryAppointmentStore(), draftService = createGroqDraftService(), allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: allowedOrigin }));
  app.use(express.json({ limit: '20kb' }));

  app.param('id', (request, response, next, id) => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      return response.status(400).json({ error: 'Record ID must contain only letters, numbers, underscores, or hyphens (up to 80 characters).' });
    }
    return next();
  });

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'clinicprep-api', storage: appointmentStore.storage, ai: 'groq-api' });
  });

  app.post('/api/drafts', async (request, response) => {
    const { values, errors } = validateAppointment(request.body);
    if (errors) return sendValidationError(response, errors);

    try {
      const draft = await draftService.generate(values);
      return response.json({ draft, source: 'groq', model: GROQ_MODEL });
    } catch (error) {
      if (error instanceof GroqDraftError) {
        console.warn(`Groq draft failed [${error.code}]: ${error.message}`);
        return response.status(error.status).json({
          error: error.message,
          code: error.code,
          fallbackMessage: 'A local rule-based draft can be used instead. Groq did not generate this fallback.',
        });
      }
      console.warn('Groq draft failed [GROQ_UNAVAILABLE]: Provider request failed without a safe diagnostic.');
      return response.status(502).json({
        error: 'Groq could not generate a draft right now.',
        code: 'GROQ_UNAVAILABLE',
        fallbackMessage: 'A local rule-based draft can be used instead. Groq did not generate this fallback.',
      });
    }
  });

  app.get('/api/appointments', async (_request, response) => {
    const items = await appointmentStore.list();
    response.json({ appointments: items });
  });

  app.get('/api/appointments/:id', async (request, response) => {
    const appointment = await appointmentStore.get(request.params.id);
    if (!appointment) return response.status(404).json({ error: 'Appointment preparation was not found.' });
    return response.json(appointment);
  });

  app.post('/api/appointments', async (request, response) => {
    const { values, errors } = validateAppointment(request.body, { allowId: true });
    if (errors) return sendValidationError(response, errors);

    const id = values.id || randomUUID();
    const now = new Date().toISOString();
    const appointment = { ...values, id, createdAt: now, updatedAt: now };
    const result = await appointmentStore.create(appointment);
    return response.status(result.created ? 201 : 200).json(result.appointment);
  });

  app.put('/api/appointments/:id', async (request, response) => {
    const existing = await appointmentStore.get(request.params.id);
    if (!existing) return response.status(404).json({ error: 'Appointment preparation was not found.' });

    const { values, errors } = validateAppointment(request.body);
    if (errors) return sendValidationError(response, errors);

    const appointment = { ...values, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    const updated = await appointmentStore.update(appointment.id, appointment);
    if (!updated) return response.status(404).json({ error: 'Appointment preparation was not found.' });
    return response.json(updated);
  });

  app.delete('/api/appointments/:id', async (request, response) => {
    if (!await appointmentStore.delete(request.params.id)) return response.status(404).json({ error: 'Appointment preparation was not found.' });
    return response.status(204).end();
  });

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint was not found.' }));

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (error?.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Request body is too large.' });
    }
    console.error('Unexpected API error.');
    return response.status(500).json({ error: 'The server could not complete the request.' });
  });

  return app;
}
