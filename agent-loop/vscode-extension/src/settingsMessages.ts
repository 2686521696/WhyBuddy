const SECRET_KEY_PATTERN = /apiKey|token|secret|password/i;

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripMessageEnvelope(value: RecordLike): RecordLike {
  const { type: _type, command: _command, payload: _payload, ...rest } = value;
  return rest;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSettingsMessageForLog(item));
  }
  if (isRecord(value)) {
    return redactSettingsMessageForLog(value);
  }
  return value;
}

export function normalizeSaveSettingsPayload(message: unknown): RecordLike {
  if (!isRecord(message)) {
    return {};
  }
  if (isRecord(message.payload)) {
    return { ...message.payload };
  }
  return stripMessageEnvelope(message);
}

export function redactSettingsMessageForLog(message: unknown): unknown {
  if (!isRecord(message)) {
    return message;
  }

  const redacted: RecordLike = {};
  for (const [key, value] of Object.entries(message)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      redacted[key] = value ? '<configured>' : '';
      continue;
    }
    redacted[key] = redactValue(value);
  }
  return redacted;
}
