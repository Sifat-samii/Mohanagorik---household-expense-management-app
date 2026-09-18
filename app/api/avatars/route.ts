import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { guardMutationOrigin, guardRateLimit, logServerError } from "@/lib/http";
import { validateUpload } from "@/lib/uploads";
import { getGoogleUser } from "../../google-auth";

type AvatarMember = { id:number; household_id:string; avatar_key:string|null };

async function currentMember(householdId:string, userId:string) {
  return env.DB!.prepare(`SELECT id, household_id, avatar_key FROM household_members
    WHERE household_id = ? AND user_id = ? AND status = 'active'`)
    .bind(householdId, userId).first<AvatarMember>();
}

export async function POST(request:NextRequest) {
  try {
    const originError = guardMutationOrigin(request);
    if (originError) return originError;
    const user = await getGoogleUser();
    if (!user) return NextResponse.json({ error:"Sign in required" }, { status:401 });
    if (!env.DB || !env.BUCKET) return NextResponse.json({ error:"Avatar storage unavailable" }, { status:503 });
    const rateLimitError = await guardRateLimit(request, user.userId, "avatar-upload");
    if (rateLimitError) return rateLimitError;

    const form = await request.formData();
    const householdId = String(form.get("householdId") ?? "").slice(0, 80);
    const file = form.get("file");
    const member = await currentMember(householdId, user.userId);
    if (!member || !(file instanceof File)) return NextResponse.json({ error:"Invalid profile photo" }, { status:400 });

    const upload = await validateUpload(file, ["jpeg", "png", "webp", "gif"], 5 * 1024 * 1024);
    if (!upload) return NextResponse.json({ error:"Use a genuine JPG, PNG, WebP, or GIF under 5 MB" }, { status:400 });

    const key = `${householdId}/avatars/${member.id}-${crypto.randomUUID()}.${upload.extension}`;
    await env.BUCKET.put(key, upload.buffer, { httpMetadata:{ contentType:upload.contentType } });
    await env.DB.prepare(`UPDATE household_members SET avatar_key = ?, avatar_choice = 'photo'
      WHERE id = ? AND user_id = ?`).bind(key, member.id, user.userId).run();
    if (member.avatar_key) {
      try { await env.BUCKET.delete(member.avatar_key); }
      catch (storageError) { logServerError(request, storageError, "replace-avatar-storage"); }
    }
    const response = NextResponse.json({ ok:true });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logServerError(request, error, "upload-avatar");
    return NextResponse.json({ error:"Profile photo upload failed" }, { status:500 });
  }
}

export async function GET(request:NextRequest) {
  const user = await getGoogleUser();
  if (!user) return new Response("Not authorized", { status:401 });
  if (!env.DB || !env.BUCKET) return new Response("Avatar storage unavailable", { status:503 });
  const memberId = Number(request.nextUrl.searchParams.get("memberId"));
  if (!Number.isInteger(memberId)) return new Response("Avatar not found", { status:404 });

  const member = await env.DB.prepare(`SELECT target.avatar_key FROM household_members target
    JOIN household_members viewer ON viewer.household_id = target.household_id
    WHERE target.id = ? AND target.status = 'active' AND viewer.user_id = ? AND viewer.status = 'active'`)
    .bind(memberId, user.userId).first<{avatar_key:string|null}>();
  if (!member?.avatar_key) return new Response("Avatar not found", { status:404 });
  const object = await env.BUCKET.get(member.avatar_key);
  if (!object) return new Response("Avatar not found", { status:404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowedContentTypes.has(headers.get("content-type") ?? "")) return new Response("Avatar not found", { status:404 });
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
