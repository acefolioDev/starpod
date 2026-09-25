import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { authentication } from "../src/kernel/security/auth";
import { createSessionId, sessions } from "../src/kernel/security/sessions";

function telemetry(spans: string[], metrics: string[]) {
  return {
    tracer: {
      startSpan(name: string) {
        spans.push(name);
        return { setAttribute() {}, recordException() {}, setStatus() {}, end() {} };
      },
    },
    metrics: {
      increment(name: string, _value?: number, labels?: Readonly<Record<string, string | number | boolean>>) {
        metrics.push(`${name}:${labels?.outcome}`);
      },
      observe() {},
    },
  };
}

describe("authentication and session telemetry", () => {
  test("traces authentication and session resolution without sensitive values", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const sessionId = createSessionId();
    const authApp = authentication(() => ({ id: "user-1" }), telemetry(spans, metrics))(new Elysia())
      .get("/", ({ user }) => user);
    const sessionApp = sessions({
      store: { get: () => ({ id: sessionId, expiresAt: Date.now() + 10_000 }) },
      ...telemetry(spans, metrics),
    })(new Elysia()).get("/", ({ session }) => session?.id ?? "missing");

    await authApp.handle(new Request("http://localhost/"));
    await sessionApp.handle(new Request("http://localhost/", {
      headers: { cookie: `session=${sessionId}` },
    }));

    expect(spans).toEqual(["security.authentication", "security.session"]);
    expect(metrics).toContain("security.authentication.operations:success");
    expect(metrics).toContain("security.session.operations:success");
    expect(JSON.stringify(spans)).not.toContain(sessionId);
  });
});
