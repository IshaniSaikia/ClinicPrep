import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { MemoryAppointmentStore } from '../src/appointment-store.js';

async function withServer(run) {
  const server = createServer(createApp({ appointmentStore: new MemoryAppointmentStore() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const sample = {
  type: 'Primary care',
  date: '2026-11-05',
  concern: 'Fictional test concern',
  notes: 'Fictional test note',
  medicines: 'None listed',
  allergies: 'None known',
  questions: 'What should I discuss?',
  summary: 'Fictional summary',
};

test('health endpoint and appointment CRUD work', async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', service: 'clinicprep-api', storage: 'memory', ai: 'groq-api' });

    const createdResponse = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.id);
    assert.equal(created.concern, sample.concern);
    assert.ok(created.createdAt);

    const listResponse = await fetch(`${baseUrl}/api/appointments`);
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).appointments.length, 1);

    const getResponse = await fetch(`${baseUrl}/api/appointments/${created.id}`);
    assert.equal(getResponse.status, 200);
    assert.equal((await getResponse.json()).id, created.id);

    const updatedResponse = await fetch(`${baseUrl}/api/appointments/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sample, concern: 'Updated fictional concern' }),
    });
    assert.equal(updatedResponse.status, 200);
    assert.equal((await updatedResponse.json()).concern, 'Updated fictional concern');

    const deletedResponse = await fetch(`${baseUrl}/api/appointments/${created.id}`, { method: 'DELETE' });
    assert.equal(deletedResponse.status, 204);
    const afterDelete = await fetch(`${baseUrl}/api/appointments/${created.id}`);
    assert.equal(afterDelete.status, 404);
  });
});

test('appointment validation and API errors are clear', async () => {
  await withServer(async (baseUrl) => {
    const invalidResponse = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Unknown visit', date: 'not-a-date', concern: '   ' }),
    });
    assert.equal(invalidResponse.status, 400);
    const invalidBody = await invalidResponse.json();
    assert.match(invalidBody.error, /Invalid appointment data/);
    assert.match(invalidBody.fields.concern, /required/i);
    assert.ok(invalidBody.fields.type);
    assert.ok(invalidBody.fields.date);

    const createdResponse = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample),
    });
    const created = await createdResponse.json();
    const invalidUpdate = await fetch(`${baseUrl}/api/appointments/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sample, notes: 'x'.repeat(2001) }),
    });
    assert.equal(invalidUpdate.status, 400);
    assert.match((await invalidUpdate.json()).fields.notes, /2000 characters or fewer/);
    const unchanged = await fetch(`${baseUrl}/api/appointments/${created.id}`);
    assert.equal((await unchanged.json()).notes, sample.notes);

    const malformedJson = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformedJson.status, 400);
    assert.match((await malformedJson.json()).error, /valid JSON/i);

    const missing = await fetch(`${baseUrl}/api/appointments/missing-record`);
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /not found/i);

    const invalidId = await fetch(`${baseUrl}/api/appointments/not%20a%20valid%20id`);
    assert.equal(invalidId.status, 400);
    assert.match((await invalidId.json()).error, /Record ID/);

    const unknownRoute = await fetch(`${baseUrl}/api/not-a-route`);
    assert.equal(unknownRoute.status, 404);
    assert.match((await unknownRoute.json()).error, /endpoint was not found/i);
  });
});

test('appointment database failures return a generic server error', async () => {
  const appointmentStore = new MemoryAppointmentStore();
  appointmentStore.list = async () => { throw new Error('private database details'); };
  const server = createServer(createApp({ appointmentStore }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/appointments`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'The server could not complete the request.' });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
