import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getGoogleUser } from "../../google-auth";

type AvatarMember = { id:number; household_id:string; avatar_key:string|null };

async function currentMember(householdId:string, userId:string) {
  return env.DB!.prepare(`SELECT id, household_id, avatar_key FROM household_members
    WHERE household_id = ? AND user_id = ? AND status = 'active'`)
    .bind(householdId, userId).first<AvatarMember>();
}

export async function POST(request:NextRequest) {
  const user = await getGoogleUser();
  if (!user) return NextResponse.json({ error:"Sign in required" }, { status:401 });
  if (!env.DB || !env.BUCKET) return NextResponse.json({ error:"Avatar storage unavailable" }, { status:503 });

  const form = await request.formData();
  const householdId = String(form.get("householdId") ?? "");
  const file = form.get("file");
  const member = await currentMember(householdId, user.userId);
  if (!member || !(file instanceof File)) return NextResponse.json({ error:"Invalid profile photo" }, { status:400 });

  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (file.size < 1 || file.size > 5 * 1024 * 1024 || !allowedTypes.has(file.type)) {
    return NextResponse.json({ error:"Use a JPG, PNG, WebP, or GIF under 5 MB" }, { status:400 });
  }

  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const key = `${householdId}/avatars/${member.id}-${crypto.randomUUID()}.${extension}`;
  await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata:{ contentType:file.type } });
  await env.DB.prepare(`UPDATE household_members SET avatar_key = ?, avatar_choice = 'photo'
    WHERE id = ? AND user_id = ?`).bind(key, member.id, user.userId).run();
  if (member.avatar_key) await env.BUCKET.delete(member.avatar_key);
  return NextResponse.json({ ok:true });
}

export async function GET(request:NextRequest) {
  const user = await getGoogleUser();
  if (!user || !env.DB || !env.BUCKET) return new Response("Not authorized", { status:401 });
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
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { headers });
}
