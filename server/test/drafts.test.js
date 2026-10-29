import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { MemoryAppointmentStore } from '../src/appointment-store.js';
import { createGroqDraftService, GroqDraftError, GROQ_CHAT_COMPLETIONS_URL, GROQ_MODEL, MEDICAL_DISCLAIMER } from '../src/groq-draft-service.js';

async function withDraftServer(draftService, run) {
  const server = createServer(createApp({ appointmentStore: new MemoryAppointmentStore(), draftService }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const fictionalAppointment = {
  type: 'Primary care',
  date: '2026-11-05',
  concern: 'Fictional demo concern',
  notes: 'Synthetic test notes',
  medicines: 'Fictional demo: none',
  allergies: 'Fictional demo: none known',
  questions: 'What information should I bring?',
};

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test('draft endpoint validates fields and returns an explicitly sourced Groq draft', async () => {
  let received;
  const draftService = {
    async generate(appointment) {
      received = appointment;
      return `MAIN CONCERN\n${appointment.concern}\n\n${MEDICAL_DISCLAIMER}`;
    },
  };

  await withDraftServer(draftService, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fictionalAppointment, concern: ' ' }),
    });
    assert.equal(invalid.status, 400);
    assert.ok((await invalid.json()).fields.concern);
    assert.equal(received, undefined);

    const response = await fetch(`${baseUrl}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fictionalAppointment),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source, 'groq');
    assert.equal(result.model, GROQ_MODEL);
    assert.match(result.draft, /not provide medical advice/i);
    assert.equal(received.concern, fictionalAppointment.concern);
    assert.equal(received.questions, fictionalAppointment.questions);
  });
});

test('draft endpoint reports missing Groq key and a truthful local fallback', async () => {
  const draftService = createGroqDraftService({ apiKey: '' });
  await withDraftServer(draftService, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fictionalAppointment),
    });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'GROQ_NOT_CONFIGURED');
    assert.match(result.fallbackMessage, /Groq did not generate this fallback/);
  });
});

test('Groq draft request uses the server key, supported model, and fictional fields', async () => {
  let requestUrl;
  let requestOptions;
  const service = createGroqDraftService({
    apiKey: 'test-key-never-returned',
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return jsonResponse({ choices: [{ message: { content: 'Organized synthetic notes.' } }] });
    },
  });

  const result = await service.generate(fictionalAppointment);
  const body = JSON.parse(requestOptions.body);
  assert.equal(requestUrl, GROQ_CHAT_COMPLETIONS_URL);
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-key-never-returned');
  assert.equal(body.model, GROQ_MODEL);
  assert.match(body.messages[1].content, /Fictional demo concern/);
  assert.match(body.messages[0].content, /Do not diagnose/);
  assert.match(result, /not provide medical advice/i);
  assert.doesNotMatch(result, /test-key-never-returned/);
});

test('Groq draft preserves the exact entered visit date if the model omits it', async () => {
  const service = createGroqDraftService({
    apiKey: 'test-key-never-returned',
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '**Visit Details**\\n- Type: Primary care\\n\\n**Main Concern**\\nFictional concern.' } }] }),
  });
  const result = await service.generate(fictionalAppointment);
  assert.match(result, /Date: 2026-11-05/);
  assert.match(result, /This is an organizational tool only/);
});

test('Groq rate limits and invalid keys get safe, distinct diagnostics', async () => {
  for (const [status, code, providerBody] of [
    [429, 'GROQ_RATE_LIMITED', { error: { message: 'rate limit reached; private detail' } }],
    [401, 'GROQ_KEY_INVALID', { error: { message: 'invalid_api_key secret-provider-detail' } }],
  ]) {
    const service = createGroqDraftService({
      apiKey: 'test-key-never-returned',
      fetchImpl: async () => jsonResponse(providerBody, status),
    });
    await assert.rejects(service.generate(fictionalAppointment), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /test-key|private detail|secret-provider-detail/);
      return true;
    });
  }
});

test('Groq network failures return a safe local-fallback response', async () => {
  const draftService = createGroqDraftService({
    apiKey: 'test-key-never-returned',
    fetchImpl: async () => { throw new Error('socket failed; bearer test-key-never-returned'); },
  });
  await withDraftServer(draftService, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fictionalAppointment),
    });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.code, 'GROQ_UNAVAILABLE');
    assert.match(result.fallbackMessage, /Groq did not generate this fallback/);
    assert.doesNotMatch(JSON.stringify(result), /test-key-never-returned|socket failed/);
  });
});

test('draft endpoint never returns provider error details', async () => {
  const draftService = {
    async generate() {
      throw new GroqDraftError('GROQ_UNAVAILABLE', 'Groq could not generate a draft right now.');
    },
  };
  await withDraftServer(draftService, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fictionalAppointment),
    });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.code, 'GROQ_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result), /secret|stack|provider details/i);
  });
});
