import { describe, expect, test } from "bun:test";
import { EventBus, EventDispatcher, EventRegistry } from "../src/kernel/events/events";
import type { JsonValue } from "../src/kernel/serialization/wire";

type Events = {
  "user.created": { readonly id: string };
  "user.deleted": { readonly id: string; readonly reason: string };
};

describe("EventBus", () => {
  test("delivers typed events in registration order", async () => {
    const bus = new EventBus<Events>();
    const events: string[] = [];

    bus.on("user.created", async ({ id }) => {
      events.push(`first:${id}`);
    });
    bus.on("user.created", ({ id }) => {
      events.push(`second:${id}`);
    });

    await bus.emit("user.created", { id: "user-1" });

    expect(events).toEqual(["first:user-1", "second:user-1"]);
  });

  test("supports unsubscribe and reports all handler failures", async () => {
    const bus = new EventBus<Events>();
    const events: string[] = [];
    const subscription = bus.on("user.deleted", () => {
      events.push("removed");
    });
    subscription.unsubscribe();
    bus.on("user.deleted", () => {
      throw new Error("first failure");
    });
    bus.on("user.deleted", () => {
      throw new Error("second failure");
    });

    await expect(bus.emit("user.deleted", { id: "user-1", reason: "privacy" })).rejects.toThrow(
      "event delivery failed: user.deleted",
    );
    expect(events).toEqual([]);
  });

  test("emits value-free lifecycle telemetry without affecting delivery", async () => {
    const events: import("../src/kernel/events/events").EventBusEvent[] = [];
    const bus = new EventBus<{ created: { id: string } }>({
      onEvent(event) {
        events.push(event);
        throw new Error("observer failed");
      },
    });
    bus.on("created", () => undefined);

    await bus.emit("created", { id: "secret-user-id" });

    expect(events).toEqual([
      { operation: "emit", name: "created", handlers: 1 },
      { operation: "handler-success", name: "created", handlerIndex: 0 },
      { operation: "complete", name: "created", handlers: 1, failures: 0 },
    ]);
    expect(JSON.stringify(events)).not.toContain("secret-user-id");
  });
});

describe("EventRegistry", () => {
  test("encodes versioned event envelopes and decodes them safely", () => {
    const registry = new EventRegistry<Events>();
    const subscription = registry.register("user.created", {
      version: "1",
      encode: (payload) => ({ id: payload.id }),
      decode: (payload) => payload as { readonly id: string },
    });

    const envelope = registry.encode("user.created", { id: "user-1" });

    expect(envelope).toEqual({
      name: "user.created",
      version: "1",
      payload: { id: "user-1" },
    });
    expect(registry.names()).toEqual(["user.created"]);
    expect(registry.decode("user.created", envelope.payload, envelope.version)).toEqual({
      id: "user-1",
    });
    expect(() => registry.decode("user.created", envelope.payload, "2")).toThrow("version mismatch");
    expect(() => registry.register("user.created", {
      encode: (payload) => payload as unknown as JsonValue,
      decode: (payload) => payload as { readonly id: string },
    })).toThrow("already registered");

    subscription.unsubscribe();
    expect(registry.names()).toEqual([]);
  });

  test("requires a codec before encoding an event for transport", () => {
    const registry = new EventRegistry<Events>();
    expect(() => registry.encode("user.deleted", { id: "user-1", reason: "privacy" }))
      .toThrow("has no codec");
    expect(() => registry.register("user.deleted", {
      version: "bad version",
      encode: (payload) => payload as unknown as JsonValue,
      decode: (payload) => payload as Events["user.deleted"],
    })).toThrow("event version");
  });
});

describe("EventDispatcher", () => {
  test("publishes a versioned encoded envelope", async () => {
    const registry = new EventRegistry<{ "user.created": { userId: string } }>();
    registry.register("user.created", {
      version: "1",
      encode: (payload) => payload,
      decode: (payload) => payload as { userId: string },
    });
    const envelopes: unknown[] = [];
    const dispatcher = new EventDispatcher(registry, {
      publish: async (envelope) => {
        envelopes.push(envelope);
      },
    });

    await dispatcher.emit("user.created", { userId: "user-1" });

    expect(envelopes).toEqual([{
      name: "user.created",
      version: "1",
      payload: { userId: "user-1" },
    }]);
  });
});
