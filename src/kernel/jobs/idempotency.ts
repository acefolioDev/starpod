import { validateJobId, validateJobName } from "./contracts";
import { validateTenantId } from "../security/tenant-id";

/** Atomic duplicate-delivery boundary for a durable job worker. */
export type JobIdempotencyStore = {
  /** Run only once for an ID; failed work must remain eligible for retry. */
  runOnce(id: string, work: () => Promise<void>): void | Promise<void>;
};

export function jobIdempotencyKey(name: string, tenantId: string | undefined, id: string) {
  validateJobName(name);
  validateTenantId(tenantId ?? "anonymous", "job tenant id");
  validateJobId(id);
  return [name, tenantId ?? "anonymous", id].map(encodeURIComponent).join(":");
}

export {
  MemoryIdempotencyStore as MemoryJobIdempotencyStore,
  type MemoryIdempotencyOptions as MemoryJobIdempotencyOptions,
} from "../data/idempotency";
