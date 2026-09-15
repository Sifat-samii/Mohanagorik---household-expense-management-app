import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clientAddress, guardRateLimit, logServerError } from "@/lib/http";
import { createSession, googleCallbackUrl, googleOAuthSettings, googleSessionCookie } from "../../../../google-auth";

const STATE_COOKIE = "__Host-mohanagorik_google_state";
const VERIFIER_COOKIE = "__Host-mohanagorik_google_pkce";

type GoogleProfile = { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

function signInError(request: Request, message: string) {
  const response = NextResponse.redirect(new URL(`/?sign_in_error=${encodeURIComponent(message)}`, request.url));
  response.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(VERIFIER_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const limited = await guardRateLimit(request, clientAddress(request), "oauth-callback");
    if (limited) return limited;
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieStore = await cookies();
    const savedState = cookieStore.get(STATE_COOKIE)?.value;
    const verifier = cookieStore.get(VERIFIER_COOKIE)?.value;

    if (!code || !state || !savedState || !verifier || state !== savedState) return signInError(request, "Unable to verify Google sign-in. Please try again.");

    const callback = googleCallbackUrl(request);
    const credentials = googleOAuthSettings();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: credentials.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: credentials.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: callback,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) return signInError(request, "Google could not complete sign-in. Please try again.");

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const profile = await profileResponse.json() as GoogleProfile;
    if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) return signInError(request, "Please use a verified Google account.");

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    response.cookies.set(VERIFIER_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    response.cookies.set(googleSessionCookie.name, await createSession({ userId: `google:${profile.sub}`, email: profile.email, displayName: profile.name?.trim() || profile.email }), googleSessionCookie.options);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logServerError(request, error, "google-oauth-callback");
    return signInError(request, "Google sign-in is temporarily unavailable. Please try again.");
  }
}
