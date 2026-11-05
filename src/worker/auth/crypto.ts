// Security primitives on WebCrypto only.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export const sha256 = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(s)));

/** Constant-time comparison of hashes, so length doesn't leak. */
export async function safeEqual(a: string, b: string) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- Passwords: PBKDF2-SHA256 ----------

/** Workers caps this at 100000; the default comes from PBKDF2_ITERATIONS. */
export async function hashPassword(password: string, saltB64: string | undefined, iterations: number) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { hash: b64url(bits), salt: b64url(salt), iterations };
}

export async function verifyPassword(password: string, user: { pw_hash: string; pw_salt: string; pw_iter: number }) {
  const { hash } = await hashPassword(password, user.pw_salt, user.pw_iter);
  return safeEqual(hash, user.pw_hash);
}

/** Readable temporary password (no ambiguous characters). */
export function temporaryPassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ---------- Secrets: AES-GCM, key derived from APP_KEY via HKDF ----------

async function aesKey(appKey: string) {
  if (typeof appKey !== "string" || appKey.length < 16) throw new Error("APP_KEY missing or too short (min. 16 characters)");
  const base = await crypto.subtle.importKey("raw", enc.encode(appKey), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("flareanalytics"), info: enc.encode("settings-encryption-v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Returns "v1.<iv>.<ciphertext>" in base64url. */
export async function encryptSecret(appKey: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(appKey), enc.encode(plaintext));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decryptSecret(appKey: string, payload: string) {
  const [v, iv, ct] = payload.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("formato de segredo inválido");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(appKey), fromB64url(ct));
  return dec.decode(pt);
}
