import type { Express, Request, Response } from "express";
import multer from "multer";
import { config } from "../config.js";
import { homebox, HomeboxApiError } from "../homebox/client.js";
import { logActivity } from "../logger.js";
import { UploadLinkError, verifyUploadToken } from "./token.js";

const ATTACHMENT_TYPES = ["photo", "manual", "warranty", "attachment", "receipt"] as const;
type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

function isAttachmentType(value: unknown): value is AttachmentType {
  return typeof value === "string" && (ATTACHMENT_TYPES as readonly string[]).includes(value);
}

function parseExp(raw: unknown): number {
  const exp = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(exp) ? exp : NaN;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderPage(opts: { itemId: string; itemName: string; exp: number; token: string; error?: string }): string {
  const { itemId, itemName, exp, token, error } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add photos — ${escapeHtml(itemName)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  .field { margin: 1rem 0; }
  input[type=file] { display: block; width: 100%; padding: 0.75rem; border: 1px dashed #999; border-radius: 8px; }
  select { padding: 0.5rem; font-size: 1rem; }
  button { padding: 0.75rem 1.5rem; font-size: 1rem; border: none; border-radius: 8px; background: #2563eb; color: white; }
  button:disabled { background: #999; }
  .error { color: #b91c1c; background: #fee2e2; padding: 0.75rem; border-radius: 8px; }
  .ok { color: #166534; background: #dcfce7; padding: 0.75rem; border-radius: 8px; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
  <h1>Add photos to: ${escapeHtml(itemName)}</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <form id="f">
    <div class="field">
      <label for="type">Type</label><br>
      <select name="type" id="type">
        <option value="photo" selected>Photo</option>
        <option value="receipt">Receipt</option>
        <option value="manual">Manual</option>
        <option value="warranty">Warranty</option>
        <option value="attachment">Other</option>
      </select>
    </div>
    <div class="field">
      <input type="file" name="files" accept="image/*,.pdf" multiple capture="environment" required>
    </div>
    <button type="submit">Upload</button>
  </form>
  <div id="result"></div>
  <script>
    const form = document.getElementById('f');
    const result = document.getElementById('result');

    function showMessage(text, cls) {
      result.textContent = '';
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = text;
      result.appendChild(p);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      const fd = new FormData(form);
      fd.append('item', ${JSON.stringify(itemId)});
      fd.append('exp', ${JSON.stringify(exp)});
      fd.append('token', ${JSON.stringify(token)});
      try {
        const res = await fetch(location.pathname, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        result.textContent = '';
        showMessage('Uploaded ' + data.uploaded + ' file(s).', 'ok');
        if (data.failed && data.failed.length) {
          const p = document.createElement('p');
          p.className = 'error';
          p.textContent = 'Failed: ' + data.failed.join(', ');
          result.appendChild(p);
        }
        form.reset();
      } catch (err) {
        showMessage((err && err.message) ? err.message : 'Upload failed', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Upload';
      }
    });
  </script>
</body>
</html>`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.bodyLimitBytes },
});

export function registerUploadRoutes(app: Express): void {
  const path = config.upload.path;

  app.get(path, async (req: Request, res: Response) => {
    const itemId = String(req.query.item ?? "");
    const exp = parseExp(req.query.exp);
    const token = String(req.query.token ?? "");

    if (!itemId || !token) {
      res.status(400).send(renderPage({ itemId: "", itemName: "Homebox", exp: 0, token: "", error: "Missing link parameters." }));
      return;
    }

    try {
      verifyUploadToken(itemId, exp, token);
    } catch (err) {
      const message = err instanceof UploadLinkError ? err.message : "Invalid upload link.";
      res.status(403).send(renderPage({ itemId, itemName: "Homebox", exp, token, error: message }));
      return;
    }

    let itemName = itemId;
    try {
      const item = await homebox.get<{ name?: string }>(`/v1/entities/${itemId}`);
      if (typeof item?.name === "string") itemName = item.name;
    } catch {
      // best-effort only -- an unresolvable name still lets the upload work
    }

    res.send(renderPage({ itemId, itemName, exp, token }));
  });

  app.post(path, upload.array("files", 10), async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const itemId = String(body.item ?? "");
    const exp = parseExp(body.exp);
    const token = String(body.token ?? "");
    const type = isAttachmentType(body.type) ? body.type : "photo";

    try {
      verifyUploadToken(itemId, exp, token);
    } catch (err) {
      const message = err instanceof UploadLinkError ? err.message : "Invalid upload link.";
      res.status(403).json({ error: message });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "No files received." });
      return;
    }

    let uploaded = 0;
    const failed: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        await homebox.request("POST", `/v1/entities/${itemId}/attachments`, {
          multipart: true,
          body: {
            file: new Blob([Buffer.from(file.buffer)]),
            name: file.originalname || `upload-${index}`,
            type,
            ...(index === 0 && type === "photo" ? { primary: "true" } : {}),
          },
        });
        uploaded += 1;
      } catch (err) {
        const message = err instanceof HomeboxApiError ? err.message : err instanceof Error ? err.message : String(err);
        logActivity("upload link: attachment failed", { itemId, file: file.originalname, error: message });
        failed.push(file.originalname || `file ${index + 1}`);
      }
    }

    logActivity("upload link: batch completed", { itemId, uploaded, failed: failed.length });
    res.json({ uploaded, failed });
  });
}
