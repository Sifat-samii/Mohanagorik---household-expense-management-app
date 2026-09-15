import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getGoogleUser } from "../../google-auth";

async function canAccessExpense(expenseId: string, userId: string) {
  return env.DB!.prepare(`SELECT e.id, e.household_id, e.receipt_key FROM expenses e
    JOIN household_members hm ON hm.household_id = e.household_id
    WHERE e.id = ? AND hm.user_id = ? AND hm.status = 'active'`).bind(expenseId, userId).first<{id:string; household_id:string; receipt_key:string|null}>();
}

export async function POST(request: NextRequest) {
  const user = await getGoogleUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!env.DB || !env.BUCKET) return NextResponse.json({ error: "Receipt storage unavailable" }, { status: 503 });
  const form = await request.formData();
  const expenseId = String(form.get("expenseId") ?? "");
  const file = form.get("file");
  const expense = await canAccessExpense(expenseId, user.userId);
  if (!expense || !(file instanceof File)) return NextResponse.json({ error: "Invalid receipt" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024 || !file.type.startsWith("image/") && file.type !== "application/pdf") return NextResponse.json({ error: "Use an image or PDF under 8 MB" }, { status: 400 });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
  const key = `${expense.household_id}/receipts/${expenseId}-${safeName}`;
  await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await env.DB.prepare(`UPDATE expenses SET receipt_key = ? WHERE id = ?`).bind(key, expenseId).run();
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const user = await getGoogleUser();
  if (!user || !env.DB || !env.BUCKET) return new Response("Not authorized", { status: 401 });
  const expenseId = request.nextUrl.searchParams.get("expenseId") ?? "";
  const expense = await canAccessExpense(expenseId, user.userId);
  if (!expense?.receipt_key) return new Response("Receipt not found", { status: 404 });
  const object = await env.BUCKET.get(expense.receipt_key);
  if (!object) return new Response("Receipt not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { headers });
}
