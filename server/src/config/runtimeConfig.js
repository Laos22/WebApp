const allowedAuthModes = new Set(["developer", "google"]);
const allowedStorageProviders = new Set(["local", "google_drive"]);

function enumValue(name, fallback, allowed) {
  const value = String(process.env[name] || fallback).trim().toLowerCase();
  if (!allowed.has(value)) {
    throw new Error(`${name} имеет недопустимое значение: ${value}`);
  }
  return value;
}

function required(name, minimumLength = 1) {
  const value = String(process.env[name] || "").trim();
  if (value.length < minimumLength) {
    throw new Error(`${name} не задан или имеет недопустимое значение`);
  }
  return value;
}

export const authMode = enumValue(
  "AUTH_MODE",
  process.env.BYPASS_AUTH === "true" ? "developer" : "google",
  allowedAuthModes,
);

export const storageProvider = enumValue(
  "STORAGE_PROVIDER",
  "local",
  allowedStorageProviders,
);

export const isDeveloperAuth = authMode === "developer";
export const isGoogleAuth = authMode === "google";
export const isGoogleDriveStorage = storageProvider === "google_drive";

export function clientOrigins() {
  return String(process.env.VITE_CLIENT_URL || "")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function googleAllowedEmails() {
  return String(process.env.GOOGLE_ALLOWED_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

export function validateRuntimeConfig() {
  const production = process.env.NODE_ENV === "production";
  required("MONGODB_URI");
  required("SESSION_SECRET", 32);
  required("ENCRYPTION_KEY", 32);

  if (isGoogleAuth || isGoogleDriveStorage) {
    required("GOOGLE_CLIENT_ID");
    required("GOOGLE_CLIENT_SECRET");
    required("VITE_SERVER_URL");
  }

  if (production) {
    const serverUrl = required("VITE_SERVER_URL");
    const origins = clientOrigins();
    if (!serverUrl.startsWith("https://") || origins.length === 0 || origins.some(origin => !origin.startsWith("https://"))) {
      throw new Error("Production требует HTTPS в VITE_SERVER_URL и VITE_CLIENT_URL");
    }
    if (isDeveloperAuth && process.env.ALLOW_DEVELOPER_AUTH_IN_PRODUCTION !== "true") {
      throw new Error(
        "AUTH_MODE=developer запрещён в production. Для закрытого staging задайте " +
        "ALLOW_DEVELOPER_AUTH_IN_PRODUCTION=true и защитите сайт внешней авторизацией.",
      );
    }
  }

  return { authMode, storageProvider, production };
}
