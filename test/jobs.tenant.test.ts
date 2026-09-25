import { describe, expect, test } from "bun:test";
import { InMemoryJobQueue } from "../src/kernel/jobs/queue";

describe("tenant-aware jobs", () => {
  test("keeps deduplication scoped to each tenant", async () => {
    const queue = new InMemoryJobQueue({ concurrency: 2, idFactory: (() => {
      let next = 0;
      return () => `tenant-job-${++next}`;
    })() });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const job = { name: "tenant-index", handle: async () => gate };

    const first = await queue.dispatch(job, {}, { tenantId: "tenant-a", deduplicationKey: "users" });
    const second = await queue.dispatch(job, {}, { tenantId: "tenant-b", deduplicationKey: "users" });
    const duplicate = await queue.dispatch(job, {}, { tenantId: "tenant-a", deduplicationKey: "users" });
    release();
    await queue.awaitIdle();

    expect(first.id).not.toBe(second.id);
    expect(duplicate).toEqual(first);
    await queue.close();
  });
});
