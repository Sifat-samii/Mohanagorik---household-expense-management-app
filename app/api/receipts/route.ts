import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationOrigin, guardRateLimit, logServerError } from "@/lib/http";
import { safeDownloadName, validateUpload } from "@/lib/uploads";
import { getGoogleUser } from "../../google-auth";

async function canAccessExpense(expenseId: string, userId: string) {
  return env.DB!.prepare(`SELECT e.id, e.household_id, e.receipt_key FROM expenses e
    JOIN household_members hm ON hm.household_id = e.household_id
    WHERE e.id = ? AND hm.user_id = ? AND hm.status = 'active'`).bind(expenseId, userId).first<{id:string; household_id:string; receipt_key:string|null}>();
}

export async function POST(request: NextRequest) {
  try {
    const originError = guardMutationOrigin(request);
    if (originError) return originError;
    const user = await getGoogleUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!env.DB || !env.BUCKET) return NextResponse.json({ error: "Receipt storage unavailable" }, { status: 503 });
    const rateLimitError = await guardRateLimit(request, user.userId, "receipt-upload");
    if (rateLimitError) return rateLimitError;
    const form = await request.formData();
    const expenseId = String(form.get("expenseId") ?? "").slice(0, 80);
    const file = form.get("file");
    const expense = await canAccessExpense(expenseId, user.userId);
    if (!expense || !(file instanceof File)) return NextResponse.json({ error: "Invalid receipt" }, { status: 400 });
    const upload = await validateUpload(file, ["jpeg", "png", "webp", "pdf"], 8 * 1024 * 1024);
    if (!upload) return NextResponse.json({ error: "Use a genuine JPG, PNG, WebP, or PDF under 8 MB" }, { status: 400 });
    const key = `${expense.household_id}/receipts/${expenseId}-${crypto.randomUUID()}.${upload.extension}`;
    await env.BUCKET.put(key, upload.buffer, { httpMetadata: { contentType: upload.contentType } });
    await env.DB.prepare(`UPDATE expenses SET receipt_key = ? WHERE id = ? AND household_id = ?`).bind(key, expenseId, expense.household_id).run();
    if (expense.receipt_key && expense.receipt_key !== key) await env.BUCKET.delete(expense.receipt_key);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logServerError(request, error, "upload-receipt");
    return NextResponse.json({ error: "Receipt upload failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getGoogleUser();
  if (!user) return new Response("Not authorized", { status: 401 });
  if (!env.DB || !env.BUCKET) return new Response("Receipt storage unavailable", { status: 503 });
  const expenseId = request.nextUrl.searchParams.get("expenseId") ?? "";
  const expense = await canAccessExpense(expenseId, user.userId);
  if (!expense?.receipt_key) return new Response("Receipt not found", { status: 404 });
  const object = await env.BUCKET.get(expense.receipt_key);
  if (!object) return new Response("Receipt not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowedContentTypes.has(headers.get("content-type") ?? "")) {
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", "attachment; filename=\"receipt\"");
  }
  headers.set("Cache-Control", "private, max-age=300");
  if (!headers.has("Content-Disposition")) headers.set("Content-Disposition", `inline; filename="${safeDownloadName(expense.receipt_key.split("/").at(-1) ?? "receipt", "receipt")}"`);
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
