const encoder = new TextEncoder();

export async function fingerprintPublicRequest(
  value: Record<string, unknown>,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function publicReplayResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { _requestFingerprint: _internal, ...publicResult } = value;
  return publicResult;
}

export function requestFingerprintMatches(
  value: unknown,
  expected: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>)._requestFingerprint === expected;
}
