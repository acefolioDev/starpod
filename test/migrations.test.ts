import { describe, expect, test } from "bun:test";
import { MigrationRunner, type MigrationStore } from "../src/kernel/data/migrations";

function storeFor(appliedIds: string[] = []) {
  const events: string[] = [];
  const store: MigrationStore = {
    applied: () => [...appliedIds],
    async withLock(work) {
      events.push("lock:acquire");
      try {
        return await work();
      } finally {
        events.push("lock:release");
      }
    },
    markApplied: (id) => {
      appliedIds.push(id);
      events.push(`apply:${id}`);
    },
    markReverted: (id) => {
      appliedIds.splice(appliedIds.indexOf(id), 1);
      events.push(`revert:${id}`);
    },
  };
  return { store, events, appliedIds };
}

describe("MigrationRunner", () => {
  test("runs pending migrations in deterministic order under a lock", async () => {
    const { store, events, appliedIds } = storeFor();
    const ran: string[] = [];
    const runner = new MigrationRunner([
      { id: "20240102-add-posts", up: () => { ran.push("posts"); }, down: () => undefined },
      { id: "20240101-add-users", up: () => { ran.push("users"); }, down: () => undefined },
    ], store, undefined);

    expect(await runner.status()).toEqual({
      applied: [],
      pending: ["20240101-add-users", "20240102-add-posts"],
    });
    expect(await runner.up()).toEqual(["20240101-add-users", "20240102-add-posts"]);
    expect(ran).toEqual(["users", "posts"]);
    expect(appliedIds).toEqual(["20240101-add-users", "20240102-add-posts"]);
    expect(events).toEqual([
      "lock:acquire",
      "apply:20240101-add-users",
      "apply:20240102-add-posts",
      "lock:release",
    ]);
  });

  test("rolls back the latest migrations in reverse order", async () => {
    const { store, events, appliedIds } = storeFor(["001", "002"]);
    const runner = new MigrationRunner([
      { id: "001", up: () => undefined, down: () => { events.push("down:001"); } },
      { id: "002", up: () => undefined, down: () => { events.push("down:002"); } },
    ], store, undefined);

    expect(await runner.down(2)).toEqual(["002", "001"]);
    expect(appliedIds).toEqual([]);
    expect(events).toEqual([
      "lock:acquire",
      "down:002",
      "revert:002",
      "down:001",
      "revert:001",
      "lock:release",
    ]);
  });

  test("fails safely on drift, duplicate ids, and missing rollback steps", async () => {
    const { store } = storeFor(["003"]);
    const runner = new MigrationRunner([{ id: "001", up: () => undefined }], store, undefined);
    await expect(runner.status()).rejects.toThrow("Applied migration is not registered: 003");
    expect(() => new MigrationRunner([
      { id: "001", up: () => undefined },
      { id: "001", up: () => undefined },
    ], store, undefined)).toThrow("Duplicate migration id: 001");

    const { store: rollbackStore } = storeFor(["001"]);
    const rollback = new MigrationRunner([{ id: "001", up: () => undefined }], rollbackStore, undefined);
    await expect(rollback.down()).rejects.toThrow("Migration 001 does not define down()");

    const { store: orderStore } = storeFor(["002", "001"]);
    const ordered = new MigrationRunner([
      { id: "001", up: () => undefined },
      { id: "002", up: () => undefined },
    ], orderStore, undefined);
    await expect(ordered.status()).rejects.toThrow("Applied migrations are out of order: 001");

    const { store: gapStore } = storeFor(["001", "003"]);
    const gapped = new MigrationRunner([
      { id: "001", up: () => undefined },
      { id: "002", up: () => undefined },
      { id: "003", up: () => undefined },
    ], gapStore, undefined);
    await expect(gapped.status()).rejects.toThrow("Applied migrations have a gap before: 003");
  });
});
