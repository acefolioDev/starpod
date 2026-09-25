import { describe, expect, test } from "bun:test";
import { Container, GraphError } from "../src/kernel/di/di";

describe("DI lifetimes", () => {
  test("keeps singleton providers shared and transient providers fresh", () => {
    class Singleton {}
    class Transient {
      static readonly lifetime = "transient" as const;
    }

    const root = new Container([Singleton, Transient]);
    const request = root.requestScope();

    expect(request.resolve(Singleton)).toBe(root.resolve(Singleton));
    expect(request.resolve(Transient)).not.toBe(request.resolve(Transient));
  });

  test("caches request providers per child scope", async () => {
    const disposed: string[] = [];
    class RequestContext {
      static readonly lifetime = "request" as const;
      readonly id = crypto.randomUUID();

      dispose() {
        disposed.push(this.id);
      }
    }

    const root = new Container([RequestContext]);
    const first = root.requestScope();
    const second = root.requestScope();
    const firstValue = first.resolve(RequestContext);
    const secondValue = second.resolve(RequestContext);

    expect(first.resolve(RequestContext)).toBe(firstValue);
    expect(secondValue).not.toBe(firstValue);

    await first.dispose();
    await second.dispose();
    expect(disposed).toEqual([firstValue.id, secondValue.id]);
  });

  test("rejects request providers outside a request scope", () => {
    class RequestContext {
      static readonly lifetime = "request" as const;
    }

    expect(() => new Container([RequestContext]).resolve(RequestContext)).toThrow(GraphError);
    expect(() => new Container([RequestContext]).resolve(RequestContext)).toThrow(
      "RequestContext is request-scoped and can only be resolved inside a request scope",
    );
  });

  test("rejects singleton providers that depend on request state", () => {
    class RequestContext {
      static readonly lifetime = "request" as const;
    }
    class Singleton {
      static readonly inject = [RequestContext] as const;
      constructor(_: RequestContext) {}
    }

    const root = new Container([RequestContext, Singleton]);

    expect(() => root.validate(Singleton)).toThrow("singleton cannot depend on request-scoped");
    expect(() => root.requestScope().resolve(Singleton)).toThrow("singleton cannot depend on request-scoped");
  });

  test("disposes lifecycle-aware transient providers", async () => {
    let disposed = 0;
    class Transient {
      static readonly lifetime = "transient" as const;
      dispose() {
        disposed += 1;
      }
    }

    const container = new Container([Transient]);
    container.resolve(Transient);
    container.resolve(Transient);
    await container.dispose();

    expect(disposed).toBe(2);
  });

  test("initializes async lifecycle-aware transient providers", async () => {
    const events: string[] = [];
    class Transient {
      static readonly lifetime = "transient" as const;
      async initialize() {
        events.push("initialize");
      }
      dispose() {
        events.push("dispose");
      }
    }

    const container = new Container([Transient]);
    await container.resolveAsync(Transient);
    await container.dispose();

    expect(events).toEqual(["initialize", "dispose"]);
  });
});
