"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSaveSettingsPayload = normalizeSaveSettingsPayload;
exports.redactSettingsMessageForLog = redactSettingsMessageForLog;
const SECRET_KEY_PATTERN = /apiKey|token|secret|password/i;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function stripMessageEnvelope(value) {
    const { type: _type, command: _command, payload: _payload, ...rest } = value;
    return rest;
}
function redactValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactSettingsMessageForLog(item));
    }
    if (isRecord(value)) {
        return redactSettingsMessageForLog(value);
    }
    return value;
}
function normalizeSaveSettingsPayload(message) {
    if (!isRecord(message)) {
        return {};
    }
    if (isRecord(message.payload)) {
        return { ...message.payload };
    }
    return stripMessageEnvelope(message);
}
function redactSettingsMessageForLog(message) {
    if (!isRecord(message)) {
        return message;
    }
    const redacted = {};
    for (const [key, value] of Object.entries(message)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            redacted[key] = value ? '<configured>' : '';
            continue;
        }
        redacted[key] = redactValue(value);
    }
    return redacted;
}
//# sourceMappingURL=settingsMessages.js.map