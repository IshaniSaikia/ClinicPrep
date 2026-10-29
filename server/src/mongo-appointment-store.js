import { MongoClient } from 'mongodb';

function fromDocument(document) {
  if (!document) return null;
  const { _id, ...fields } = document;
  return { ...fields, id: _id };
}

export class MongoAppointmentStore {
  constructor(collection, client) {
    this.collection = collection;
    this.client = client;
    this.storage = 'mongodb';
  }

  async list() {
    const documents = await this.collection.find({}).sort({ updatedAt: -1 }).toArray();
    return documents.map(fromDocument);
  }

  async get(id) {
    return fromDocument(await this.collection.findOne({ _id: id }));
  }

  async create(appointment) {
    const { id, ...fields } = appointment;
    try {
      await this.collection.insertOne({ _id: id, ...fields });
      return { appointment, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await this.get(id);
      if (!existing) throw error;
      return { appointment: existing, created: false };
    }
  }

  async update(id, appointment) {
    const { id: _ignored, ...fields } = appointment;
    const result = await this.collection.updateOne({ _id: id }, { $set: fields });
    return result.matchedCount ? appointment : null;
  }

  async delete(id) {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async close() {
    await this.client.close();
  }
}

export async function connectMongoAppointmentStore(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const collection = client.db('clinicprep').collection('appointments');
    await collection.findOne({}, { projection: { _id: 1 } });
    return new MongoAppointmentStore(collection, client);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
