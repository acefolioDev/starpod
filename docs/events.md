# Events

Events decouple a fact from the code that reacts to it. Starpod provides typed in-process delivery plus explicit boundaries for serialized delivery and an outbox. It does not ship a broker.

## In-process events

```ts
import { EventBus } from "starpod";

type Events = { "user.created": { userId: string } };
const events = new EventBus<Events>();

events.on("user.created", ({ userId }) => {
  console.log("created", userId);
});

await events.emit("user.created", { userId: "u_123" });
```

Handlers run in registration order. Delivery failures are aggregated. `onEvent`, `tracer`, and `metrics` provide value-free lifecycle telemetry; payloads are not placed in telemetry.

## Crossing a process boundary

Register a codec with `EventRegistry` before encoding. The versioned envelope is transport-safe and can be consumed by `EventConsumer`.

```ts
const registry = new EventRegistry<Events>();
registry.register("user.created", {
  version: "1",
  encode: (event) => event,
  decode: (payload) => payload as Events["user.created"],
});

const envelope = registry.encode("user.created", { userId: "u_123" });
```

`EventDispatcher` publishes an envelope; the broker owns acknowledgement, retries, ordering, consumer groups, and dead letters. Add an `EventIdempotencyStore` to `EventConsumer` when duplicate delivery is possible.

## Transactional outbox

Use `EventOutbox.enqueue()` inside the same database transaction as the domain write, then publish pending records from a worker.

```ts
const record = await outbox.enqueue("user.created", { userId }, { transaction });
await outbox.publishPending(100);
```

If publishing succeeds but marking the record fails, the event may be delivered again. Consumers must be idempotent.

## Common mistakes

- Treating an in-process event as durable delivery.
- Serializing a handler closure instead of a versioned payload.
- Assuming event order across instances.
- Publishing before the database transaction commits.

## Production notes

Choose a broker, delivery policy, schema compatibility policy, retry/dead-letter strategy, and atomic idempotency store. Tenant IDs can be carried explicitly, but consumers must still select the right data and authorization boundary.

