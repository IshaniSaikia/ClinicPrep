import 'dotenv/config';
import { createApp } from './app.js';
import { connectMongoAppointmentStore } from './mongo-appointment-store.js';

const port = Number(process.env.PORT) || 3002;

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured. Add your private Atlas connection string to server/.env.');
  }

  const appointmentStore = await connectMongoAppointmentStore(process.env.MONGODB_URI);
  const server = createApp({ appointmentStore }).listen(port, () => {
    console.log(`ClinicPrep API connected to MongoDB and listening on port ${port}`);
  });

  const shutdown = async () => {
    server.close();
    await appointmentStore.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error) => {
  if (error.message.startsWith('MONGODB_URI is not configured.')) {
    console.error(`ClinicPrep API could not start: ${error.message}`);
  } else {
    console.error('ClinicPrep API could not connect to MongoDB. Check the Atlas URI, database user, and Network Access settings.');
  }
  process.exitCode = 1;
});
