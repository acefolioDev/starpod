import { describe, expect, test } from "bun:test";
import { application, pod } from "../src/kernel/application/feature";
import { plugin } from "../src/kernel/application/plugins";
import { createTestApplication } from "../src/kernel/application/testing";
import type { StarpodElysia } from "../src/kernel/http/http";

describe("application plugins", () => {
  test("configure native Elysia and contribute real DI providers", async () => {
    class Greeting {
      readonly value = "from-plugin";
    }
    class Controller {
      static readonly inject = [Greeting] as const;

      constructor(private readonly greeting: Greeting) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.greeting.value);
      }
    }
    const extension = plugin({
      name: "shared",
      providers: [Greeting],
      configure: (app) => app.get("/plugin", () => "native"),
    });
    const testApp = await createTestApplication(application({
      features: [pod({ name: "hello", prefix: "/hello", controller: Controller })],
      plugins: [extension],
    }), { seal: false });

    try {
      expect(await (await testApp.request("/plugin")).text()).toBe("native");
      expect(await (await testApp.request("/hello/")).text()).toBe("from-plugin");
    } finally {
      await testApp.dispose();
    }
  });

  test("rejects duplicate plugin names and provider tokens", () => {
    class Provider {}
    const first = plugin({ name: "first", configure: (app) => app });
    const second = plugin({ name: "first", configure: (app) => app });
    const controller = class {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    };
    const features = [pod({ name: "hello", prefix: "/hello", controller })];

    expect(() => application({ features, plugins: [first, second] })).toThrow(
      "Duplicate plugin name: first",
    );
    expect(() => plugin({
      name: "shared",
      providers: [Provider, Provider],
      configure: (app) => app,
    })).toThrow("Duplicate plugin provider in shared");
  });
});
