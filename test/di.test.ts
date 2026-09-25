import { describe, expect, test } from "bun:test";
import { Container, GraphError } from "../src/kernel/di/di";

class Clock {
  readonly id = Symbol("clock");
}

class UserService {
  static readonly inject = [Clock] as const;

  constructor(readonly clock: Clock) {}
}

class UserController {
  static readonly inject = [UserService] as const;

  constructor(readonly users: UserService) {}
}

describe("Container", () => {
  test("resolves constructor dependencies and caches app providers", () => {
    const root = new Container([Clock]);
    const scope = root.scope([UserService, UserController]);
    const first = scope.resolve(UserService);
    const second = scope.resolve(UserController);

    expect(first.clock).toBe(second.users.clock);
    expect(root.resolve(Clock)).toBe(first.clock);
  });

  test("rejects unregistered dependencies", () => {
    expect(() => new Container().resolve(UserService)).toThrow(GraphError);
    expect(() => new Container().resolve(UserService)).toThrow(
      "UserService is not registered",
    );
  });

  test("detects dependency cycles", () => {
    class A {
      constructor(_: B) {}
    }

    class B {
      static readonly inject = [A] as const;

      constructor(_: A) {}
    }

    Object.defineProperty(A, "inject", { value: [B] });

    expect(() => new Container([A, B]).resolve(A)).toThrow("circular dependency: A -> B -> A");
  });

  test("rejects an incorrect injection declaration", () => {
    class Broken {
      static readonly inject = [Clock] as const;

      constructor() {}
    }

    expect(() => new Container([Broken, Clock]).resolve(Broken)).toThrow(
      "Broken: inject.length (1) must match constructor parameters (0)",
    );
  });

  test("validates a graph without constructing providers", () => {
    let constructed = 0;
    class SideEffect {
      constructor() {
        constructed += 1;
      }
    }

    const container = new Container([SideEffect]);
    container.validate(SideEffect);

    expect(constructed).toBe(0);
    expect(container.resolve(SideEffect)).toBeInstanceOf(SideEffect);
    expect(constructed).toBe(1);
  });
});
