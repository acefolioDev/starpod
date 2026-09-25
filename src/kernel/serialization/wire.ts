export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function assertJsonValue(
  value: JsonValue,
  label = "value",
  seen = new Set<object>(),
) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(label + " must contain only finite JSON numbers");
  }
  if (typeof value !== "object") throw new Error(label + " must be JSON-safe");
  if (seen.has(value)) throw new Error(label + " contains a cyclic payload");
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, label + "[" + index + "]", seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(label + " must contain only plain objects");
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, label + "." + key, seen);
    }
  }
}
