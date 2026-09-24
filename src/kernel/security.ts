export type SecurityHeaderTarget = Record<string, string | number>;

export type SecurityHeadersOptions = {
  readonly hsts?: {
    readonly maxAge?: number;
    readonly includeSubDomains?: boolean;
    readonly preload?: boolean;
  };
};

export function applySecurityHeaders(
  headers: SecurityHeaderTarget,
  options: SecurityHeadersOptions = {},
) {
  validateOptions(options);
  headers["x-content-type-options"] = "nosniff";
  headers["x-frame-options"] = "DENY";
  headers["referrer-policy"] = "no-referrer";
  headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()";

  if (options.hsts) {
    const maxAge = options.hsts.maxAge ?? 31536000;
    const parts = [`max-age=${maxAge}`];
    if (options.hsts.includeSubDomains ?? true) parts.push("includeSubDomains");
    if (options.hsts.preload) parts.push("preload");
    headers["strict-transport-security"] = parts.join("; ");
  }
}

function validateOptions(options: SecurityHeadersOptions) {
  const maxAge = options.hsts?.maxAge;
  if (maxAge !== undefined && (!Number.isInteger(maxAge) || maxAge < 0)) {
    throw new Error("Security header HSTS maxAge must be a non-negative integer");
  }
}
