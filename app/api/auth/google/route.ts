import { NextResponse } from "next/server";
import { googleOAuthSettings } from "../../../google-auth";

const STATE_COOKIE = "mohanagorik_google_state";

export async function GET(request: Request) {
  const state = crypto.randomUUID();
  const callback = new URL("/api/auth/google/callback", request.url).toString();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: googleOAuthSettings().GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: callback,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  const response = NextResponse.redirect(google);
  response.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
