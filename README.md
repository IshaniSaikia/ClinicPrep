# ClinicPrep

ClinicPrep is an educational prototype for organizing notes before a healthcare appointment. It does not diagnose, recommend treatment, prescribe medication, or assess emergencies. Use fictional information while exploring the demo.

## Current build status

- React and Vite frontend with an appointment preparation form.
- Appointment drafts can be generated through the Express API with Groq (`openai/gpt-oss-20b`) or explicitly fall back to local rule-based formatting when Groq is unavailable.
- Drafts can be edited, copied, downloaded as a formatted A4 PDF, and saved through the local API.
- The browser keeps a local cache and syncs cached records into the API when its in-memory store is empty.
- Express provides health and appointment CRUD endpoints backed by MongoDB Atlas when configured. The API will not start without `MONGODB_URI`; tests use an isolated in-memory store and do not need Atlas credentials.
- The Groq key is read only by the server from `server/.env`. Draft requests send the entered appointment fields to Groq; use fictional data only. This demo has no accounts or private-user separation.

## Project folders

- `client/` — React website and responsive styles.
- `server/` — Express API.
- `.env.example` — backend environment variable names with placeholders only.
- `server/.env` — private local backend settings; create this from `.env.example` and keep real credentials here only.
- `client/.env.example` — public frontend API URL example. `VITE_` values are visible in the browser; never put secrets there.

## Local development

Install Node.js 22 or a current supported Node.js LTS release. Before starting the API, create an Atlas Free cluster, add a database user, and allow your current IP under Network Access. From the `server` directory, create the private settings file with `Copy-Item ..\.env.example .env`; set `MONGODB_URI` there to the Atlas connection string. Create a Groq API key at [Groq Console](https://console.groq.com/keys), keep the account on its free tier, and set `GROQ_API_KEY` in the same `server/.env` file. Never put either secret in frontend files or `VITE_` variables. The API uses the `openai/gpt-oss-20b` model; rate limits are enforced by Groq and unavailable requests use the clearly labeled local fallback.

Backend environment variables are `PORT` (defaults to `3002`), `FRONTEND_ORIGIN` (defaults to `http://localhost:5173`), `MONGODB_URI`, and `GROQ_API_KEY`. The client example contains only `VITE_API_BASE_URL`, which stays blank for local development so Vite can proxy `/api` to Express. Any `VITE_` value is public in the browser.

Then open two terminals in VS Code.

In the first terminal (the API uses port `3002` and the `clinicprep` database):

```powershell
cd D:\ClinicPrep\server
npm install
npm run dev
```

In the second terminal:

```powershell
cd D:\ClinicPrep\client
npm install
npm run dev -- --host 0.0.0.0
```

Open the frontend at `http://localhost:5173`. The API health endpoint is `http://localhost:3002/api/health`. In local development, Vite proxies `/api` requests to Express on port `3002`. The frontend checks the health endpoint and loads/saves records through the API.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Confirm the API is running. |
| `POST` | `/api/drafts` | Generate a healthcare-visit organizational draft using Groq. |
| `GET` | `/api/appointments` | List saved preparations. |
| `GET` | `/api/appointments/:id` | Retrieve one preparation. |
| `POST` | `/api/appointments` | Create a preparation. |
| `PUT` | `/api/appointments/:id` | Replace a preparation's editable fields. |
| `DELETE` | `/api/appointments/:id` | Delete a preparation. |

Appointment types are `Primary care`, `Specialist`, `Dental`, `Mental health`, and `Other`. The main concern is required. Dates must use `YYYY-MM-DD`; text fields have server-side length limits. Invalid requests return HTTP `400` with a message and field details. Missing IDs return HTTP `404`.

If Groq is missing, rejects the key, or reaches its free-tier limit, `/api/drafts` returns a clear error and the frontend creates a local rule-based draft labeled as a fallback. Only a successful API response is labeled as a Groq draft.

## Checks

From `server/`, run `npm test` for the API health, CRUD, validation, and error tests. From `client/`, run `npm run build` and `npm run lint`.

## Responsible use and privacy

This prototype is not a medical device or a substitute for a healthcare professional. The browser cache can be accessed by someone using the same browser profile. Groq API draft requests send user-entered text to Groq; fictional data should be used for demonstrations.
