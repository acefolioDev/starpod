import { describe, expect, test } from "bun:test";
import { createTestApplication } from "../src/kernel/application/testing";
import { application, pod } from "../src/kernel/application/feature";
import type { StarpodElysia } from "../src/kernel/http/http";

describe("test application", () => {
  test("sends native requests and disposes the bootstrapped graph", async () => {
    const events: string[] = [];

    class Resource {
      dispose() {
        events.push("dispose");
      }
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }

    const testApp = await createTestApplication(
      application({
        features: [pod({ name: "testing", prefix: "/testing", controller: Controller })],
        providers: [Resource],
      }),
      { seal: false },
    );

    const response = await testApp.request("/testing/");
    await testApp.dispose();
    await testApp.dispose();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(events).toEqual(["dispose"]);
  });
});
