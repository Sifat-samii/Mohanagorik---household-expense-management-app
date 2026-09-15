import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

type RateLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

export function requestId(request: Request) {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function apiJson(data: unknown, status = 200, id?: string) {
  const response = NextResponse.json(data, { status });
  response.headers.set("Cache-Control", "no-store");
  if (id) response.headers.set("X-Request-Id", id);
  return response;
}

export function guardMutationOrigin(request: NextRequest) {
  const id = requestId(request);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const configuredOrigin = (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN?.trim();
  let expectedOrigin = request.nextUrl.origin;
  try {
    if (configuredOrigin) expectedOrigin = new URL(configuredOrigin).origin;
  } catch {
    return apiJson({ error: "Application origin is misconfigured" }, 503, id);
  }
  if (!origin || origin !== expectedOrigin || site === "cross-site") {
    return apiJson({ error: "Request origin could not be verified" }, 403, id);
  }
  return null;
}

export async function guardRateLimit(request: Request, actor: string, scope: string) {
  const binding = (env as unknown as { RATE_LIMITER?: RateLimiter }).RATE_LIMITER;
  if (!binding) return null;
  const { success } = await binding.limit({ key: `${scope}:${actor}` });
  if (success) return null;
  const response = apiJson({ error: "Too many requests. Please try again shortly." }, 429, requestId(request));
  response.headers.set("Retry-After", "60");
  return response;
}

export function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export function logServerError(request: Request, error: unknown, operation: string) {
  console.error(JSON.stringify({
    level: "error",
    operation,
    requestId: requestId(request),
    message: error instanceof Error ? error.message : "Unknown error",
  }));
}
