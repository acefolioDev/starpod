import { describe, expect, test } from "bun:test";
import { HttpClient, HttpClientError } from "../src/kernel/http-client";

describe("HttpClient", () => {
  test("uses native fetch semantics with a base URL and typed JSON", async () => {
    let receivedUrl = "";
    let receivedHeader = "";
    const client = new HttpClient({
      baseUrl: "https://api.example.test/v1/",
      headers: { "x-client": "starpod" },
      fetch: async (input, init) => {
        receivedUrl = String(input);
        receivedHeader = new Headers(init?.headers).get("x-client") ?? "";
        return new Response(JSON.stringify({ id: "user-1" }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await client.json<{ id: string }>("users/user-1");

    expect(result).toEqual({ id: "user-1" });
    expect(receivedUrl).toBe("https://api.example.test/v1/users/user-1");
    expect(receivedHeader).toBe("starpod");
  });

  test("retries transient GET responses but does not retry POST by default", async () => {
    let getAttempts = 0;
    const getClient = new HttpClient({
      retries: 1,
      retryDelayMs: 0,
      fetch: async () => {
        getAttempts += 1;
        return getAttempts === 1 ? new Response("busy", { status: 503 }) : new Response("ok");
      },
    });

    expect(await getClient.text("https://api.example.test/status")).toBe("ok");
    expect(getAttempts).toBe(2);

    let postAttempts = 0;
    const postClient = new HttpClient({
      retries: 2,
      retryDelayMs: 0,
      fetch: async () => {
        postAttempts += 1;
        return new Response("busy", { status: 503 });
      },
    });

    const response = await postClient.request("https://api.example.test/write", {
      method: "POST",
      body: "payload",
    });

    expect(response.status).toBe(503);
    expect(postAttempts).toBe(1);
  });

  test("reports structured HTTP failures without leaking query values", async () => {
    const client = new HttpClient({
      fetch: async () => new Response("no", { status: 401 }),
    });

    let failure: unknown;
    try {
      await client.json("https://api.example.test/users?token=secret");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(HttpClientError);
    expect(failure).toMatchObject({
      code: "HTTP_STATUS",
      status: 401,
      url: "https://api.example.test/users",
    });
    expect(String(failure)).not.toContain("secret");
  });

  test("rejects credentials embedded in a target URL", async () => {
    const client = new HttpClient({ fetch: async () => new Response("never") });

    await expect(client.request("https://user:password@api.example.test/users")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  test("enforces a bounded parsed response size", async () => {
    const client = new HttpClient({
      maxResponseBytes: 3,
      fetch: async () => new Response("1234"),
    });

    await expect(client.text("https://api.example.test/large")).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  test("turns an aborted timeout into a typed error", async () => {
    const client = new HttpClient({
      timeoutMs: 5,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });

    await expect(client.request("https://api.example.test/slow")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  test("isolates observer failures and emits safe attempt telemetry", async () => {
    const events: unknown[] = [];
    const client = new HttpClient({
      onEvent(event) {
        events.push(event);
        throw new Error("observer failed");
      },
      fetch: async () => new Response("ok"),
    });

    expect(await client.text("https://api.example.test/users?email=private@example.test")).toBe("ok");
    expect(events).toEqual([
      expect.objectContaining({
        operation: "attempt",
        outcome: "response",
        method: "GET",
        url: "https://api.example.test/users",
      }),
    ]);
  });
});
