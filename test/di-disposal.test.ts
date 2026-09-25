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

  test("waits for in-flight initialization before disposing", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class Resource {
      async initialize() {
        events.push("initialize:start");
        await gate;
        events.push("initialize:end");
      }

      dispose() {
        events.push("dispose");
      }
    }

    const container = new Container([Resource]);
    container.resolve(Resource);
    const initializing = container.initialize();
    await Promise.resolve();
    const disposing = container.dispose();
    release();
    await Promise.all([initializing, disposing]);

    expect(events).toEqual(["initialize:start", "initialize:end", "dispose"]);
  });

  test("shares concurrent disposal calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let disposed = 0;
    class Resource {
      async dispose() {
        await gate;
        disposed += 1;
      }
    }

    const container = new Container([Resource]);
    container.resolve(Resource);
    const first = container.dispose();
    const second = container.dispose();
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(disposed).toBe(1);
  });

  test("keeps transient singleton dependencies with the singleton owner", async () => {
    const events: string[] = [];
    class Dependency {
      static readonly lifetime = "transient" as const;

      dispose() {
        events.push("dependency");
      }
    }

    class Singleton {
      static readonly inject = [Dependency] as const;

      constructor(_: Dependency) {}

      dispose() {
        events.push("singleton");
      }
    }

    const root = new Container([Dependency, Singleton]);
    const feature = root.scope([]);
    feature.resolve(Singleton);

    await feature.dispose();
    await root.dispose();

    expect(events).toEqual(["singleton", "dependency"]);
  });
});
