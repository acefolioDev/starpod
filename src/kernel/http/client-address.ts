import { isIP } from "node:net";

export type ProxyTrust = boolean | ((address: string) => boolean);

export type ClientIpOptions = {
  /** The peer address observed by the server or hosting adapter. */
  readonly peerAddress: string;
  /** Forwarded headers are ignored unless the direct peer is trusted. */
  readonly trustProxy?: ProxyTrust;
};

/**
 * Resolve a client IP without trusting spoofable forwarding headers by default.
 * The hosting adapter must provide the direct socket peer address.
 */
export function clientIp(request: Request, options: ClientIpOptions): string {
  const peer = validateAddress(options.peerAddress, "peerAddress");
  const trust = options.trustProxy ?? false;
  if (!isTrusted(peer, trust)) return peer;

  const raw = request.headers.get("x-forwarded-for");
  if (!raw) return peer;
  const chain = parseForwardedFor(raw);
  if (chain.length === 0) return peer;

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = chain[index]!;
    if (!isTrusted(address, trust)) return address;
  }
  return chain[0]!;
}

function parseForwardedFor(value: string): string[] {
  if (value.length > 4_096) return [];
  const addresses = value.split(",").map((item) => item.trim());
  if (addresses.some((item) => !item || isIP(item) === 0)) return [];
  return addresses;
}

function validateAddress(value: string, label: string): string {
  const address = value.trim();
  if (!address || isIP(address) === 0) throw new Error(`HTTP ${label} must be a valid IPv4 or IPv6 address`);
  return address;
}

function isTrusted(address: string, trust: ProxyTrust): boolean {
  return trust === true || (typeof trust === "function" && trust(address));
}
