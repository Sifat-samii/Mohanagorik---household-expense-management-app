import { env } from "cloudflare:workers";
import { apiJson, logServerError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    if (!env.DB || !env.BUCKET) return apiJson({ status: "degraded" }, 503);
    await env.DB.prepare("SELECT 1 AS healthy").first();
    return apiJson({ status: "ok" });
  } catch (error) {
    logServerError(request, error, "health-check");
    return apiJson({ status: "degraded" }, 503);
  }
}
