const EXPIRY_PARAMETER = "_starpod_expires";
const SIGNATURE_PARAMETER = "_starpod_signature";
const MIN_SECRET_BYTES = 32;

export type SignedUrlOptions = {
  /** Absolute epoch time in milliseconds when the URL stops being valid. */
  readonly expiresAt: number;
  readonly now?: () => number;
};

export type VerifySignedUrlOptions = {
  readonly now?: () => number;
  /** Permit small clock differences between the signer and verifier. */
  readonly clockSkewMs?: number;
};

/** Sign an absolute URL with an expiring HMAC-SHA-256 query signature. */
export async function createSignedUrl(
  input: string | URL,
  secret: string,
  options: SignedUrlOptions,
): Promise<string> {
  const now = options.now ?? Date.now;
  const url = parseUrl(input);
  validateSecret(secret);
  validateExpiry(options.expiresAt, now());
  rejectReservedParameters(url.searchParams);

  url.searchParams.set(EXPIRY_PARAMETER, String(options.expiresAt));
  const signature = await sign(canonicalUrl(url), secret);
  url.searchParams.set(SIGNATURE_PARAMETER, signature);
  return url.toString();
}

/** Verify the expiry and HMAC signature of a URL without changing the input. */
export async function verifySignedUrl(
  input: string | URL,
  secret: string,
  options: VerifySignedUrlOptions = {},
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const url = parseUrl(input);
  validateSecret(secret);
  if (count(url.searchParams, EXPIRY_PARAMETER) !== 1 || count(url.searchParams, SIGNATURE_PARAMETER) !== 1) {
    return false;
  }

  const expiresAt = Number(url.searchParams.get(EXPIRY_PARAMETER));
  const skew = options.clockSkewMs ?? 0;
  if (!Number.isFinite(skew) || skew < 0 || !Number.isFinite(expiresAt) || expiresAt <= now() - skew) {
    return false;
  }

  const received = url.searchParams.get(SIGNATURE_PARAMETER);
  if (!received || !/^[A-Za-z0-9_-]{43}$/.test(received)) return false;
  url.searchParams.delete(SIGNATURE_PARAMETER);
  const expected = await sign(canonicalUrl(url), secret);
  return constantTimeEqual(received, expected);
}

function parseUrl(input: string | URL) {
  const url = new URL(input.toString());
  if (url.username || url.password) throw new Error("signed URLs must not contain URL credentials");
  return url;
}

function canonicalUrl(url: URL) {
  const copy = new URL(url.toString());
  copy.searchParams.sort();
  return copy.toString();
}

function rejectReservedParameters(params: URLSearchParams) {
  if (count(params, EXPIRY_PARAMETER) > 0 || count(params, SIGNATURE_PARAMETER) > 0) {
    throw new Error("URL already contains Starpod signed URL parameters");
  }
}

function count(params: URLSearchParams, name: string) {
  return params.getAll(name).length;
}

function validateSecret(secret: string) {
  if (new TextEncoder().encode(secret).byteLength < MIN_SECRET_BYTES) {
    throw new Error("signed URL secret must be at least 32 UTF-8 bytes");
  }
}

function validateExpiry(expiresAt: number, now: number) {
  if (!Number.isFinite(expiresAt) || !Number.isInteger(expiresAt) || expiresAt <= now) {
    throw new Error("signed URL expiresAt must be a future epoch millisecond integer");
  }
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
