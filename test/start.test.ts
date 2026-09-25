import { describe, expect, test } from "bun:test";
import { application, pod } from "../src/kernel/feature";
import { start } from "../src/kernel/start";
import type { StarpodElysia } from "../src/kernel/http";

describe("start", () => {
  test("starts native Elysia and disposes the provider graph exactly once", async () => {
    let disposals = 0;
    class Resource {
      dispose() {
        disposals += 1;
      }
    }

    class Controller {
      static readonly inject = [Resource] as const;

      constructor(private readonly resource: Resource) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.resource instanceof Resource ? "ok" : "bad");
      }
    }

    const started = await start(
      application({
        features: [pod({ name: "start", prefix: "/start", controller: Controller })],
        providers: [Resource],
      }),
      { listen: 0, printFeatures: false, seal: false, shutdown: false },
    );

    const response = await started.server.handle(new Request("http://localhost/start/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");

    await started.stop();
    await started.stop();
    expect(disposals).toBe(1);
  });
});
