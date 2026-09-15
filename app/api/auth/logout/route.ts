import { NextResponse } from "next/server";
import { googleSessionCookie } from "../../../google-auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(googleSessionCookie.name, "", { ...googleSessionCookie.options, maxAge: 0 });
  return response;
}
