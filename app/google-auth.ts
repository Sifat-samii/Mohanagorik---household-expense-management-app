import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export type GoogleUser = {
  userId: string;
  displayName: string;
  email: string;
};

type SessionPayload = GoogleUser & { expiresAt: number };

const SESSION_COOKIE = "mohanagorik_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function settings() {
  const values = env as unknown as {
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_SESSION_SECRET?: string;
  };
  if (!values.GOOGLE_OAUTH_CLIENT_ID || !values.GOOGLE_OAUTH_CLIENT_SECRET || !values.GOOGLE_SESSION_SECRET) {
    throw new Error("Google sign-in has not been configured");
  }
  return values as Required<typeof values>;
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

async function signature(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(settings().GOOGLE_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function createSession(user: GoogleUser) {
  const payload: SessionPayload = { ...user, expiresAt: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${encoded}.${await signature(encoded)}`;
}

export async function getGoogleUser(): Promise<GoogleUser | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const [encoded, receivedSignature] = value.split(".");
  if (!encoded || !receivedSignature || receivedSignature !== await signature(encoded)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (!payload.userId || !payload.email || !payload.displayName || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId, email: payload.email, displayName: payload.displayName };
  } catch {
    return null;
  }
}

export function googleOAuthSettings() {
  return settings();
}

export const googleSessionCookie = {
  name: SESSION_COOKIE,
  maxAge: SESSION_MAX_AGE,
  options: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: SESSION_MAX_AGE },
};
