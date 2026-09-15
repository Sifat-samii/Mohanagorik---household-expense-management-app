export type UploadKind = "jpeg" | "png" | "webp" | "gif" | "pdf";

const signatures: Record<UploadKind, (bytes: Uint8Array) => boolean> = {
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => b[index] === value),
  webp: (b) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  gif: (b) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...b.slice(0, 6))),
  pdf: (b) => b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-",
};

const contentTypes: Record<UploadKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

const extensions: Record<UploadKind, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif", pdf: "pdf" };

export async function validateUpload(file: File, allowed: UploadKind[], maximumBytes: number) {
  if (file.size < 1 || file.size > maximumBytes) return null;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const kind = allowed.find((candidate) => signatures[candidate](bytes));
  if (!kind || file.type !== contentTypes[kind]) return null;
  return { buffer, contentType: contentTypes[kind], extension: extensions[kind] };
}

export function safeDownloadName(value: string, fallback: string) {
  const name = value.replace(/[\r\n"\\/]/g, "-").replace(/[^a-zA-Z0-9._ -]/g, "-").slice(-80);
  return name || fallback;
}
