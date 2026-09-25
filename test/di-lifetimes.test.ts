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
});
