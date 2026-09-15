import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export type GoogleUser = {
  userId: string;
  displayName: string;
  email: string;
};

type SessionPayload = GoogleUser & { issuedAt: number; expiresAt: number; version: 1 };

const SESSION_COOKIE = "__Host-mohanagorik_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function settings() {
  const values = env as unknown as {
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_SESSION_SECRET?: string;
    APP_ORIGIN?: string;
  };
  if (!values.GOOGLE_OAUTH_CLIENT_ID || !values.GOOGLE_OAUTH_CLIENT_SECRET || !values.GOOGLE_SESSION_SECRET) {
    throw new Error("Google sign-in has not been configured");
  }
  if (values.GOOGLE_SESSION_SECRET.length < 32) throw new Error("GOOGLE_SESSION_SECRET must be at least 32 characters");
  return values as Required<Pick<typeof values, "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET" | "GOOGLE_SESSION_SECRET">> & Pick<typeof values, "APP_ORIGIN">;
}

const toBase64Url = (value: string | ArrayBuffer) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(settings().GOOGLE_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signature(value: string) {
  const key = await signingKey();
  return toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function createSession(user: GoogleUser) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...user, issuedAt, expiresAt: issuedAt + SESSION_MAX_AGE, version: 1 };
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${encoded}.${await signature(encoded)}`;
}

export async function getGoogleUser(): Promise<GoogleUser | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const [encoded, receivedSignature] = value.split(".");
  if (!encoded || !receivedSignature) return null;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(receivedSignature),
      new TextEncoder().encode(encoded),
    );
    if (!verified) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.version !== 1 || !payload.userId || !payload.email || !payload.displayName || payload.issuedAt > now + 60 || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt > SESSION_MAX_AGE) return null;
    return { userId: payload.userId, email: payload.email, displayName: payload.displayName };
  } catch {
    return null;
  }
}

export function googleOAuthSettings() {
  return settings();
}

export function googleCallbackUrl(request: Request) {
  const configuredOrigin = settings().APP_ORIGIN?.trim();
  if (!configuredOrigin) return new URL("/api/auth/google/callback", request.url).toString();
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
    throw new Error("APP_ORIGIN must be an HTTPS origin without a path");
  }
  return new URL("/api/auth/google/callback", origin).toString();
}

export function randomOAuthToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes.buffer);
}

export async function pkceChallenge(verifier: string) {
  return toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export const googleSessionCookie = {
  name: SESSION_COOKIE,
  maxAge: SESSION_MAX_AGE,
  options: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: SESSION_MAX_AGE },
};
