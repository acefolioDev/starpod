import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  clearSessionCookie,
  createSessionId,
  requireSession,
  sessionCookie,
  sessions,
  type Session,
} from "../src/kernel/security/sessions";

describe("sessions", () => {
  test("creates opaque ids and secure cookies", () => {
    const id = createSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionCookie(id)).toContain("HttpOnly");
    expect(sessionCookie(id)).toContain("Secure");
    expect(sessionCookie(id)).toContain("SameSite=Lax");
  });

  test("resolves valid sessions through native Elysia context", async () => {
    const session: Session = { id: createSessionId(), expiresAt: Date.now() + 10_000 };
    const server = sessions({ store: { get: (id) => id === session.id ? session : null } })(new Elysia())
      .get("/", ({ session: resolved }) => resolved?.id ?? "missing");
    const response = await server.handle(new Request("http://localhost/", {
      headers: { cookie: `session=${session.id}` },
    }));
    expect(await response.text()).toBe(session.id);
  });

  test("clears expired sessions and rejects required sessions", async () => {
    const session: Session = { id: createSessionId(), expiresAt: 0 };
    let deleted = "";
    const app = sessions({
      required: true,
      store: { get: () => session, delete: (id) => { deleted = id; } },
    })(new Elysia()).get("/", () => "ok");
    const response = await app.handle(new Request("http://localhost/", {
      headers: { cookie: `session=${session.id}` },
    }));
    expect(response.status).toBe(401);
    expect(deleted).toBe(session.id);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("rejects a store result for a different session ID", async () => {
    const requested = createSessionId();
    const different = { id: createSessionId(), expiresAt: Date.now() + 10_000 };
    const app = sessions({
      required: true,
      store: { get: () => different },
    })(new Elysia()).get("/", () => "ok");

    const response = await app.handle(new Request("http://localhost/", {
      headers: { cookie: `session=${requested}` },
    }));
    expect(response.status).toBe(401);
  });

  test("validates cookie settings and required values", () => {
    const id = createSessionId();
    expect(() => sessionCookie(id, { sameSite: "none", secure: false })).toThrow("Secure");
    expect(() => sessionCookie("short")).toThrow("session id");
    const headers: Record<string, string> = {};
    clearSessionCookie(headers);
    expect(headers["set-cookie"]).toContain("Max-Age=0");
    expect(() => requireSession({ id, expiresAt: 0 })).toThrow("session");
    expect(() => requireSession({ id: "short", expiresAt: Date.now() + 10_000 })).toThrow("session");
    expect(() => requireSession({ id, expiresAt: Number.NaN })).toThrow("session");
  });
});
