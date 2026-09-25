import { describe, expect, test } from "bun:test";
import { Container } from "../src/kernel/di/di";

describe("Container disposal", () => {
  test("initializes instances in dependency order", async () => {
    const events: string[] = [];

    class Database {
      initialize() {
        events.push("database");
      }
    }

    class Worker {
      static readonly inject = [Database] as const;

      constructor(_: Database) {}

      initialize() {
        events.push("worker");
      }
    }

    const container = new Container([Database, Worker]);
    container.resolve(Worker);
    await container.initialize();
    await container.initialize();

    expect(events).toEqual(["database", "worker"]);
  });

  test("disposes instances in reverse creation order", async () => {
    const events: string[] = [];

    class Database {
      dispose() {
        events.push("database");
      }
    }

    class Worker {
      static readonly inject = [Database] as const;

      constructor(_: Database) {}

      dispose() {
        events.push("worker");
      }
    }

    const container = new Container([Database, Worker]);
    container.resolve(Worker);
    await container.dispose();
    await container.dispose();

    expect(events).toEqual(["worker", "database"]);
    expect(() => container.resolve(Database)).toThrow("container has already been disposed");
  });

  test("attempts every cleanup and reports failures", async () => {
    const events: string[] = [];

    class First {
      dispose() {
        events.push("first");
        throw new Error("first failed");
      }
    }

    class Second {
      dispose() {
        events.push("second");
      }
    }

    const container = new Container([First, Second]);
    container.resolve(First);
    container.resolve(Second);

    await expect(container.dispose()).rejects.toThrow("container disposal failed");
    expect(events).toEqual(["second", "first"]);
  });
});
