/** Validate tenant identifiers before they cross an async or storage boundary. */
export function validateTenantId(value: string, label = "tenant id") {
  if (!value || value.length > 256 || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string of at most 256 characters`);
  }
  return value;
}
