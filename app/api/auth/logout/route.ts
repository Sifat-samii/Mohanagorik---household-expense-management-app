import { NextResponse } from "next/server";
import { guardMutationOrigin } from "@/lib/http";
import { googleSessionCookie } from "../../../google-auth";

export async function POST(request: import("next/server").NextRequest) {
  const rejected = guardMutationOrigin(request);
  if (rejected) return rejected;
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(googleSessionCookie.name, "", { ...googleSessionCookie.options, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
