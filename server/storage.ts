// Storage helpers.
//
// Preferred backend: Supabase Storage (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
// Fallback backend:  Manus Forge presigned S3 (BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY).
//
// Supabase files live in a PRIVATE bucket. Room members receive a time-limited
// signed URL that streams straight from Supabase (Range requests supported),
// so the app server never proxies audio bytes.

import { ENV } from "./_core/env";

export type StoredObject = { key: string; url: string };

// Signed URLs should outlive the room (rooms expire after 12h of inactivity).
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 13;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export function storageProvider(): "supabase" | "forge" | "none" {
  if (ENV.supabaseUrl && ENV.supabaseServiceRoleKey) return "supabase";
  if (ENV.forgeApiUrl && ENV.forgeApiKey) return "forge";
  return "none";
}

/* ------------------------------ Supabase ------------------------------ */

function supabaseHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
    apikey: ENV.supabaseServiceRoleKey,
    ...extra,
  };
}

function encodePath(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

let bucketReady: Promise<void> | null = null;

// Creates the private bucket on first use. Safe to call repeatedly.
function ensureSupabaseBucket(): Promise<void> {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const resp = await fetch(`${ENV.supabaseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        id: ENV.supabaseBucket,
        name: ENV.supabaseBucket,
        public: false,
        file_size_limit: MAX_UPLOAD_BYTES,
        allowed_mime_types: ["audio/*"],
      }),
    });
    if (resp.ok) return;
    const text = await resp.text().catch(() => "");
    // Already exists → fine.
    if (resp.status === 409 || /already exists|Duplicate/i.test(text)) return;
    throw new Error(`Supabase bucket setup failed (${resp.status}): ${text}`);
  })().catch(error => {
    bucketReady = null; // retry next time
    throw error;
  });
  return bucketReady;
}

async function supabasePut(key: string, data: Buffer | Uint8Array | string, contentType: string) {
  await ensureSupabaseBucket();
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  const resp = await fetch(
    `${ENV.supabaseUrl}/storage/v1/object/${encodeURIComponent(ENV.supabaseBucket)}/${encodePath(key)}`,
    {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "max-age=3600" }),
      body,
    },
  );
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Supabase upload failed (${resp.status}): ${msg}`);
  }
}

async function supabaseSignedUrl(key: string, expiresIn = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const resp = await fetch(
    `${ENV.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(ENV.supabaseBucket)}/${encodePath(key)}`,
    {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn }),
    },
  );
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Supabase signed URL failed (${resp.status}): ${msg}`);
  }
  const json = (await resp.json()) as { signedURL?: string; signedUrl?: string };
  const signed = json.signedURL ?? json.signedUrl;
  if (!signed) throw new Error("Supabase returned no signed URL");
  if (/^https?:\/\//i.test(signed)) return signed;
  return `${ENV.supabaseUrl}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}

async function supabaseDelete(keys: string[]) {
  const resp = await fetch(`${ENV.supabaseUrl}/storage/v1/object/${encodeURIComponent(ENV.supabaseBucket)}`, {
    method: "DELETE",
    headers: supabaseHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: keys }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Supabase delete failed (${resp.status}): ${msg}`);
  }
}

/* -------------------------------- Forge -------------------------------- */

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error("Storage config missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or the Manus Forge variables).");
  }
  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

async function forgePut(key: string, data: Buffer | Uint8Array | string, contentType: string) {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, { headers: { Authorization: `Bearer ${forgeKey}` } });
  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }
  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data as any], { type: contentType });
  const uploadResp = await fetch(s3Url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!uploadResp.ok) throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
}

/* ------------------------------ Public API ------------------------------ */

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<StoredObject> {
  const provider = storageProvider();
  if (provider === "none") {
    throw new Error("Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.");
  }
  const key = appendHashSuffix(normalizeKey(relKey));
  if (provider === "supabase") {
    await supabasePut(key, data, contentType);
    return { key, url: await supabaseSignedUrl(key) };
  }
  await forgePut(key, data, contentType);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<StoredObject> {
  const key = normalizeKey(relKey);
  if (storageProvider() === "supabase") return { key, url: await supabaseSignedUrl(key) };
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  if (storageProvider() === "supabase") return supabaseSignedUrl(key);

  const { forgeUrl, forgeKey } = getForgeConfig();
  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);
  const resp = await fetch(getUrl, { headers: { Authorization: `Bearer ${forgeKey}` } });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }
  const { url } = (await resp.json()) as { url: string };
  return url;
}

// Best-effort cleanup. Only Supabase supports deletion here; Forge objects are left to its own lifecycle.
export async function storageDelete(keys: string[]): Promise<void> {
  if (!keys.length || storageProvider() !== "supabase") return;
  await supabaseDelete(keys.map(normalizeKey));
}
