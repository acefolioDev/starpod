import { describe, expect, test } from "bun:test";
import { DatabaseConnection } from "../src/kernel/data/database";

describe("DatabaseConnection", () => {
  test("owns connection lifecycle and delegates transactions", async () => {
    const events: string[] = [];
    const database = new DatabaseConnection({
      async connect() {
        events.push("connect");
        return { id: "client" };
      },
      async close(client) {
        events.push(`close:${client.id}`);
      },
      async transaction(client, work) {
        events.push(`transaction:${client.id}`);
        return work({ id: "transaction" });
      },
      async ping(client) {
        events.push(`ping:${client.id}`);
      },
    });

    expect(database.status).toBe("disconnected");
    await database.initialize();
    expect(database.status).toBe("connected");
    expect(await database.use((client) => client.id)).toBe("client");
    expect(await database.transaction((transaction) => transaction.id)).toBe("transaction");
    await database.ping();
    await database.dispose();
    await database.dispose();

    expect(events).toEqual([
      "connect",
      "transaction:client",
      "ping:client",
      "close:client",
    ]);
    expect(database.status).toBe("closed");
  });

  test("shares concurrent initialization and retries after a failed connection", async () => {
    let attempts = 0;
    const database = new DatabaseConnection({
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("database offline");
        return { ready: true };
      },
      close: () => undefined,
      transaction: (_client, work) => work({ ready: true }),
    });

    await expect(Promise.all([database.initialize(), database.initialize()])).rejects.toThrow("database offline");
    expect(database.status).toBe("disconnected");
    await database.initialize();
    expect(database.status).toBe("connected");
    expect(attempts).toBe(2);
  });

  test("closes a client that finishes connecting after disposal starts", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = 0;
    const database = new DatabaseConnection({
      connect: async () => {
        await gate;
        return { id: "late" };
      },
      close: () => {
        closed += 1;
      },
      transaction: (_client, work) => work({ id: "late-transaction" }),
    });

    const connecting = database.initialize().catch(() => undefined);
    await Promise.resolve();
    const disposing = database.dispose();
    release();
    await Promise.all([connecting, disposing]);

    expect(closed).toBe(1);
    expect(database.status).toBe("closed");
  });
});
