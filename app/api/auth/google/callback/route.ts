import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, googleOAuthSettings, googleSessionCookie } from "../../../../google-auth";

const STATE_COOKIE = "mohanagorik_google_state";

type GoogleProfile = { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

function signInError(request: Request, message: string) {
  return NextResponse.redirect(new URL(`/?sign_in_error=${encodeURIComponent(message)}`, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = (await cookies()).get(STATE_COOKIE)?.value;

  if (!code || !state || !savedState || state !== savedState) return signInError(request, "Unable to verify Google sign-in. Please try again.");

  const callback = new URL("/api/auth/google/callback", request.url).toString();
  const credentials = googleOAuthSettings();
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: credentials.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: callback,
      grant_type: "authorization_code",
    }),
  });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) return signInError(request, "Google could not complete sign-in. Please try again.");

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = await profileResponse.json() as GoogleProfile;
  if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) return signInError(request, "Please use a verified Google account.");

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(googleSessionCookie.name, await createSession({ userId: `google:${profile.sub}`, email: profile.email, displayName: profile.name?.trim() || profile.email }), googleSessionCookie.options);
  return response;
}
