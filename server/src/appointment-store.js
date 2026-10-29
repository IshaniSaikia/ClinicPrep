export class MemoryAppointmentStore {
  constructor(records = new Map()) {
    this.records = records;
    this.storage = 'memory';
  }

  async list() {
    return [...this.records.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id) {
    return this.records.get(id) || null;
  }

  async create(appointment) {
    const existing = this.records.get(appointment.id);
    if (existing) return { appointment: existing, created: false };
    this.records.set(appointment.id, appointment);
    return { appointment, created: true };
  }

  async update(id, appointment) {
    if (!this.records.has(id)) return null;
    this.records.set(id, appointment);
    return appointment;
  }

  async delete(id) {
    return this.records.delete(id);
  }
}
