import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export class UploadLinkError extends Error {}

/** Constant-time compare that tolerates length mismatches (Node's
 * timingSafeEqual throws instead of returning false on one). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function sign(itemId: string, exp: number): string {
  if (!config.upload.linkSecret) {
    throw new UploadLinkError(
      "UPLOAD_LINK_SECRET is not set -- items_upload_link cannot mint a link without it (see .env.example).",
    );
  }
  return createHmac("sha256", config.upload.linkSecret).update(`${itemId}.${exp}`).digest("hex");
}

/** Mints a signed, time-limited token for one item. The link this backs
 * grants upload-only access to exactly this item, nothing else -- it is not
 * a general credential. */
export function issueUploadToken(itemId: string): { exp: number; token: string } {
  const exp = Math.floor(Date.now() / 1000) + config.upload.linkTtlSeconds;
  return { exp, token: sign(itemId, exp) };
}

export function verifyUploadToken(itemId: string, exp: number, token: string): void {
  if (!Number.isFinite(exp)) throw new UploadLinkError("Missing or invalid expiry.");
  if (Math.floor(Date.now() / 1000) > exp) {
    throw new UploadLinkError("This upload link has expired. Ask Claude for a new one.");
  }
  const expected = sign(itemId, exp);
  if (!safeEqual(token, expected)) {
    throw new UploadLinkError("Invalid upload link.");
  }
}
