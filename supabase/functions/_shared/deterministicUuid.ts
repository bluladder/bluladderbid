/**
 * Produce a stable UUID-shaped primary key from server-owned lineage inputs.
 * The SHA-256 digest prevents raw provider/session identifiers from appearing
 * in the identifier while allowing concurrent first writers to converge on
 * one database row without a separate lookup-then-insert race.
 */
export async function deterministicUuid(
  scope: string,
  ...parts: string[]
): Promise<string> {
  const payload = JSON.stringify([scope, ...parts]);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
  ).slice(0, 16);
  // RFC 4122 variant with a name-derived version marker.
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}
