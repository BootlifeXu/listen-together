import type { Express } from "express";
import { Readable } from "node:stream";
import { ENV } from "./env";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      const storageResp = await fetch(url, {
        headers: req.headers.range ? { Range: req.headers.range } : undefined,
      });
      if (!storageResp.ok && storageResp.status !== 206) {
        res.status(storageResp.status).send("Stored media could not be loaded");
        return;
      }
      res.status(storageResp.status);
      res.set("Cache-Control", "private, max-age=300");
      res.set("Accept-Ranges", storageResp.headers.get("accept-ranges") ?? "bytes");
      for (const header of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
        const value = storageResp.headers.get(header);
        if (value) res.set(header, value);
      }
      if (storageResp.body) {
        Readable.fromWeb(storageResp.body as import("node:stream/web").ReadableStream).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
