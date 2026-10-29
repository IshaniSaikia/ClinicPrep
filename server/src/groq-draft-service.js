export const GROQ_MODEL = 'openai/gpt-oss-20b';
export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const MEDICAL_DISCLAIMER = 'This is an organizational tool only. It does not provide medical advice, diagnose conditions, recommend treatment or medication, or assess emergencies.';

export class GroqDraftError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'GroqDraftError';
    this.code = code;
    this.status = status;
  }
}

function errorDetails(providerError) {
  const error = providerError?.error || providerError;
  return `${error?.code || ''} ${error?.type || ''} ${error?.message || ''}`.toLowerCase();
}

function classifyProviderError(status, providerError) {
  const detail = errorDetails(providerError);
  if (status === 401 || /invalid_api_key|authentication_error/.test(detail)) {
    return new GroqDraftError('GROQ_KEY_INVALID', 'Groq rejected the API key. Verify that the key is active and copied correctly.', 503);
  }
  if (status === 429 || /rate_limit|too many requests|quota/.test(detail)) {
    return new GroqDraftError('GROQ_RATE_LIMITED', 'Groq’s current free-tier request or token limit has been reached. Try again after the limit resets.', 503);
  }
  if (status === 404 || /model_decommissioned|model_not_found|model.*not found/.test(detail)) {
    return new GroqDraftError('GROQ_MODEL_UNAVAILABLE', 'The configured Groq model is unavailable. Check the current Groq model list.', 503);
  }
  if (status === 402 || /billing_not_active|organization_deactivated/.test(detail)) {
    return new GroqDraftError('GROQ_ACCOUNT_UNAVAILABLE', 'Groq did not allow this request for the current account. Check the account and model access in the Groq console.', 503);
  }
  if (status === 403) {
    return new GroqDraftError('GROQ_ACCESS_DENIED', 'Groq denied access to this API request. Check the key and project permissions in the Groq console.', 503);
  }
  return new GroqDraftError('GROQ_UNAVAILABLE', 'Groq could not generate a draft right now.');
}

const systemInstruction = [
  'You format appointment notes for a personal healthcare visit organizer.',
  'Only organize the user-provided information. Do not answer the user’s questions or add facts, interpretations, or suggestions.',
  'Do not diagnose, recommend treatment, discuss medication changes or dosing, or assess urgency or emergencies.',
  'Keep the user’s meaning intact and preserve every non-empty field. If a date is provided, include its exact YYYY-MM-DD value under Visit Details. Omit empty fields. Use plain text with clear headings for visit details, main concern, notes, current medicines, allergies, and questions for the healthcare professional.',
  'Do not infer medical facts from the appointment type or date.',
].join(' ');

export function createGroqDraftService({ apiKey = process.env.GROQ_API_KEY, fetchImpl = globalThis.fetch, model = GROQ_MODEL } = {}) {
  return {
    async generate(appointment) {
      if (!apiKey) {
        throw new GroqDraftError('GROQ_NOT_CONFIGURED', 'Groq is not configured. Add GROQ_API_KEY to server/.env.', 503);
      }

      let response;
      try {
        response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `Organize these user-entered fields as an appointment preparation draft. Do not answer questions.\n\n${JSON.stringify(appointment)}` },
            ],
            max_tokens: 1200,
            temperature: 0.2,
          }),
        });
      } catch {
        throw new GroqDraftError('GROQ_UNAVAILABLE', 'Groq could not be reached. Check the server’s network connection and try again.');
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new GroqDraftError('GROQ_UNAVAILABLE', 'Groq returned an unreadable response. Please try again.');
      }
      if (!response.ok) throw classifyProviderError(response.status, payload);

      const text = payload?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new GroqDraftError('GROQ_EMPTY_RESPONSE', 'Groq did not return a draft.');
      const dateLine = appointment.date && !text.includes(appointment.date) ? `- Date: ${appointment.date}` : '';
      const draft = dateLine
        ? /\*\*Visit Details\*\*/i.test(text)
          ? text.replace(/(\*\*Visit Details\*\*)/i, `$1\n${dateLine}`)
          : `**Visit Details**\n- Type: ${appointment.type}\n${dateLine}\n\n${text}`
        : text;
      return `${draft}\n\n${MEDICAL_DISCLAIMER}`;
    },
  };
}
