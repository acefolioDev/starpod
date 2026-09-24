import { describe, expect, test } from "bun:test";
import { EventBus, EventRegistry } from "../src/kernel/events";
import type { JsonValue } from "../src/kernel/wire";

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
