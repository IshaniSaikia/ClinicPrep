import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoAppointmentStore } from '../src/mongo-appointment-store.js';

function makeCollection() {
  const documents = new Map();
  return {
    find() {
      return {
        sort() {
          return { toArray: async () => [...documents.values()] };
        },
      };
    },
    async findOne({ _id }) {
      return documents.get(_id) || null;
    },
    async insertOne(document) {
      if (documents.has(document._id)) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      documents.set(document._id, document);
    },
    async updateOne({ _id }, { $set }) {
      if (!documents.has(_id)) return { matchedCount: 0 };
      documents.set(_id, { ...documents.get(_id), ...$set });
      return { matchedCount: 1 };
    },
    async deleteOne({ _id }) {
      return { deletedCount: Number(documents.delete(_id)) };
    },
  };
}

test('Mongo appointment store preserves API IDs and CRUD semantics', async () => {
  const store = new MongoAppointmentStore(makeCollection(), { close: async () => {} });
  const record = {
    id: 'fictional-record',
    type: 'Primary care',
    date: '2026-11-05',
    concern: 'Fictional concern',
    notes: '',
    medicines: '',
    allergies: '',
    questions: '',
    summary: '',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
  };

  assert.deepEqual(await store.create(record), { appointment: record, created: true });
  assert.deepEqual(await store.get(record.id), record);
  assert.deepEqual(await store.list(), [record]);
  assert.deepEqual(await store.create(record), { appointment: record, created: false });

  const updated = { ...record, concern: 'Updated fictional concern', updatedAt: '2026-10-28T00:00:00.000Z' };
  assert.deepEqual(await store.update(record.id, updated), updated);
  assert.equal((await store.get(record.id)).concern, updated.concern);
  assert.equal(await store.delete(record.id), true);
  assert.equal(await store.get(record.id), null);
  assert.equal(await store.delete(record.id), false);
});
