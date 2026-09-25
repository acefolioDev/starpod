export {
  MemoryIdempotencyStore as MemoryEventIdempotencyStore,
  type MemoryIdempotencyOptions as MemoryEventIdempotencyOptions,
} from "../data/idempotency";

export function eventIdempotencyKey(id: string, tenantId: string | undefined) {
  validateId(id);
  return tenantId === undefined ? id : `${tenantId.length}:${tenantId}${id}`;
}

function validateId(id: string) {
  if (!id || id.length > 1_024 || /[\r\n]/.test(id)) {
    throw new Error("event idempotency key must be a non-empty single-line string of at most 1024 characters");
  }
}
