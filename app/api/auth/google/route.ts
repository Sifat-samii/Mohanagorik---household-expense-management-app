import { NextResponse } from "next/server";
import { clientAddress, guardRateLimit } from "@/lib/http";
import { googleCallbackUrl, googleOAuthSettings, pkceChallenge, randomOAuthToken } from "../../../google-auth";

const STATE_COOKIE = "__Host-mohanagorik_google_state";
const VERIFIER_COOKIE = "__Host-mohanagorik_google_pkce";

export async function GET(request: Request) {
  const limited = await guardRateLimit(request, clientAddress(request), "oauth-start");
  if (limited) return limited;
  const state = randomOAuthToken();
  const verifier = randomOAuthToken();
  const callback = googleCallbackUrl(request);
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: googleOAuthSettings().GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: callback,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const response = NextResponse.redirect(google);
  const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set(STATE_COOKIE, state, cookieOptions);
  response.cookies.set(VERIFIER_COOKIE, verifier, cookieOptions);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
