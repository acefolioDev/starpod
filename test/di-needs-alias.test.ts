import { describe, expect, test } from "bun:test";
import { Container, GraphError } from "../src/kernel/di/di";
import { application, pod } from "../src/kernel/application/feature";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import type { StarpodElysia } from "../src/kernel/http/http";

class Clock {
  readonly label = "clock";
}

describe("class dependency aliases", () => {
  test("resolves and validates a class with only needs", () => {
    class NeedsOnly {
      static readonly needs = [Clock] as const;

      constructor(readonly clock: Clock) {}
    }

    const container = new Container([Clock, NeedsOnly]);

    expect(() => container.validate(NeedsOnly)).not.toThrow();
    expect(container.resolve(NeedsOnly).clock.label).toBe("clock");
  });

  test("boots a native application with a needs-only provider", async () => {
    class NeedsService {
      static readonly needs = [Clock] as const;

      constructor(private readonly clock: Clock) {}

      label() {
        return this.clock.label;
      }
    }

    class NeedsController {
      static readonly inject = [NeedsService] as const;

      constructor(private readonly service: NeedsService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => ({ label: this.service.label() }));
      }
    }

    const app = application({
      features: [pod({
        name: "needs",
        prefix: "/needs",
        controller: NeedsController,
        providers: [NeedsService],
      })],
      providers: [Clock],
    });
    const server = await bootstrap(app, { seal: false, printFeatures: false });

    try {
      const response = await server.handle(new Request("http://starpod.test/needs/"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ label: "clock" });
    } finally {
      await disposeBootstrap(server);
    }
  });

  test("keeps inject-only classes working", () => {
    class InjectOnly {
      static readonly inject = [Clock] as const;

      constructor(readonly clock: Clock) {}
    }

    const container = new Container([Clock, InjectOnly]);

    expect(() => container.validate(InjectOnly)).not.toThrow();
    expect(container.resolve(InjectOnly).clock).toBeInstanceOf(Clock);
  });

  test("accepts matching inject and needs tuples", () => {
    class Both {
      static readonly inject = [Clock] as const;
      static readonly needs = [Clock] as const;

      constructor(readonly clock: Clock) {}
    }

    const container = new Container([Clock, Both]);

    expect(() => container.validate(Both)).not.toThrow();
    expect(container.resolve(Both).clock).toBeInstanceOf(Clock);
  });

  test("rejects different inject and needs tuples with GraphError", () => {
    class Other {}
    class Conflicting {
      static readonly inject = [Clock] as const;
      static readonly needs = [Other] as const;

      constructor(readonly clock: Clock) {}
    }

    expect(() => new Container([Clock, Other, Conflicting]).validate(Conflicting)).toThrow(GraphError);
    expect(() => new Container([Clock, Other, Conflicting]).validate(Conflicting)).toThrow(
      "Conflicting: inject and needs dependency tuples must match",
    );
  });

  test("still rejects constructor dependencies without either tuple", () => {
    class MissingDeclaration {
      constructor(readonly clock: Clock) {}
    }

    expect(() => new Container([Clock, MissingDeclaration]).validate(MissingDeclaration)).toThrow(GraphError);
    expect(() => new Container([Clock, MissingDeclaration]).validate(MissingDeclaration)).toThrow(
      "MissingDeclaration: dependency tuple length (0) must match constructor parameters (1)",
    );
  });
});
