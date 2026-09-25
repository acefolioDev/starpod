import { describe, expect, test } from "bun:test";
import {
  EventOutbox,
  type EventOutboxStore,
  type OutboxRecord,
} from "../src/kernel/events/outbox";
import { EventRegistry, type EventEnvelope } from "../src/kernel/events/events";

type Events = { "user.created": { readonly id: string } };

class FakeOutboxStore implements EventOutboxStore<string> {
  readonly records: OutboxRecord[] = [];
  readonly transactions: unknown[] = [];
  failed: Array<{ id: string; nextAttemptAt: number }> = [];
  published: string[] = [];

  append(record: OutboxRecord, transaction?: string) {
    this.records.push(record);
    this.transactions.push(transaction);
  }

  claim(limit: number) {
    return this.records.slice(0, limit).map((record) => ({ ...record, attempts: record.attempts + 1 }));
  }

  markPublished(id: string) {
    this.published.push(id);
  }

  markFailed(id: string, nextAttemptAt: number) {
    this.failed.push({ id, nextAttemptAt });
  }
}

function setup() {
  const registry = new EventRegistry<Events>();
  registry.register("user.created", {
    version: "1",
    encode: (payload) => payload,
    decode: (payload) => payload as Events["user.created"],
  });
  const store = new FakeOutboxStore();
  const published: EventEnvelope[] = [];
  const outbox = new EventOutbox(registry, store, {
    publish: async (envelope) => { published.push(envelope); },
  }, { idFactory: () => "outbox-1", now: () => 1000 });
  return { outbox, store, published };
}

describe("EventOutbox", () => {
  test("appends encoded events with the caller transaction", async () => {
    const { outbox, store } = setup();
    const record = await outbox.enqueue("user.created", { id: "user-1" }, {
      transaction: "tx-1",
      tenantId: "tenant-1",
    });

    expect(record).toMatchObject({ id: "outbox-1", createdAt: 1000, attempts: 0 });
    expect(record.envelope).toEqual({
      id: "outbox-1",
      name: "user.created",
      version: "1",
      tenantId: "tenant-1",
      payload: { id: "user-1" },
    });
    expect(store.transactions).toEqual(["tx-1"]);
  });

  test("publishes claimed events and schedules failed deliveries", async () => {
    const { outbox, store, published } = setup();
    await outbox.enqueue("user.created", { id: "user-1" });
    const registry = new EventRegistry<Events>();
    registry.register("user.created", {
      version: "1", encode: (payload) => payload, decode: (payload) => payload as Events["user.created"],
    });
    const retrying = new EventOutbox(registry, store, {
      publish: async (envelope) => { published.push(envelope); throw new Error("broker down"); },
    }, { now: () => 1000, retryDelayMs: () => 250 });

    const successful = await outbox.publishPending();
    const failed = await retrying.publishPending();
    expect(successful).toEqual({ claimed: 1, published: 1, failed: 0 });
    expect(failed).toEqual({ claimed: 1, published: 0, failed: 1 });
    expect(store.published).toEqual(["outbox-1"]);
    expect(store.failed).toEqual([{ id: "outbox-1", nextAttemptAt: 1250 }]);
    expect(published).toHaveLength(2);
  });

});
