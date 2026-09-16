import { encryptData, decryptData } from "./encryptionService.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

function normalizeUserId(userId) {
  const value = typeof userId === "string" ? userId : userId?.toHexString?.();
  if (!nonEmpty(value)) throw new Error("Invalid Drive credentials owner");
  return value;
}

/** Return a new allowlisted object; missing values are normalized to null. */
export function validateDriveTokens(tokens) {
  if (!isObject(tokens)) throw new Error("Invalid Drive tokens");
  const result = {};
  for (const key of ["access_token", "refresh_token"]) {
    const value = tokens[key];
    if (value != null && typeof value !== "string") throw new Error("Invalid Drive tokens");
    result[key] = value ?? null;
  }
  const expiry = tokens.expiry_date;
  if (expiry != null && (typeof expiry !== "number" || !Number.isFinite(expiry) || expiry <= 0)) {
    throw new Error("Invalid Drive tokens");
  }
  result.expiry_date = expiry ?? null;
  return result;
}

/** Creates an envelope only; does not persist or increment stored revisions. */
export function encryptDriveTokens({ userId, tokens }) {
  const payload = { userId: normalizeUserId(userId), tokens: validateDriveTokens(tokens) };
  const ciphertext = encryptData(JSON.stringify(payload));
  if (!nonEmpty(ciphertext)) throw new Error("Unable to encrypt Drive credentials");
  return { version: 1, revision: 1, ciphertext };
}

export function decryptDriveTokens(input) {
  try {
    const { userId, driveCredentials } = input;
    const owner = normalizeUserId(userId);
    if (!isObject(driveCredentials) || driveCredentials.version !== 1 ||
        !Number.isInteger(driveCredentials.revision) || driveCredentials.revision < 1 ||
        !nonEmpty(driveCredentials.ciphertext)) {
      throw new Error();
    }
    const plaintext = decryptData(driveCredentials.ciphertext);
    if (typeof plaintext !== "string") throw new Error();
    const payload = JSON.parse(plaintext);
    if (!isObject(payload) || payload.userId !== owner) throw new Error();
    return validateDriveTokens(payload.tokens);
  } catch {
    throw new Error("Unable to decrypt Drive credentials");
  }
}

/** Caller must explicitly select both hidden fields; null means no envelope. */
export function selectStoredDriveTokens(settingsDocument) {
  if (!isObject(settingsDocument)) throw new Error("Invalid settings document");
  // Do not mistake a Mongoose projection for an absent encrypted value.
  if (typeof settingsDocument.isSelected === "function" &&
      (!settingsDocument.isSelected("driveCredentials") || !settingsDocument.isSelected("driveTokens"))) {
    throw new Error("Drive credential fields must be explicitly selected");
  }
  if (settingsDocument.driveCredentials != null) {
    return {
      source: "encrypted",
      tokens: decryptDriveTokens({ userId: settingsDocument.userId, driveCredentials: settingsDocument.driveCredentials }),
    };
  }
  if (settingsDocument.driveTokens != null) {
    return { source: "legacy", tokens: validateDriveTokens(settingsDocument.driveTokens) };
  }
  return { source: "none", tokens: null };
}

export function mergeDriveTokens(previousTokens, incomingTokens) {
  const previous = validateDriveTokens(previousTokens);
  const incoming = validateDriveTokens(incomingTokens);
  return {
    access_token: nonEmpty(incoming.access_token) ? incoming.access_token : previous.access_token,
    refresh_token: nonEmpty(incoming.refresh_token) ? incoming.refresh_token : previous.refresh_token,
    expiry_date: incoming.expiry_date ?? previous.expiry_date,
  };
}

export function hasUsableDriveTokens(tokens, now = Date.now()) {
  try {
    const normalized = validateDriveTokens(tokens);
    return nonEmpty(normalized.refresh_token) ||
      (nonEmpty(normalized.access_token) && normalized.expiry_date !== null && normalized.expiry_date > now);
  } catch {
    return false;
  }
}
