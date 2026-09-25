---
title: "Events: announce facts, don’t summon strangers"
label: "Events"
description: "Use typed domain events, a transactional outbox, and durable consumer idempotency for production workflows."
section: runtime
order: 40
---

## Why use events?

An event says that a fact has already happened. It is useful when one action has several independent consequences.

For example, once an order is paid, the application may need to send a receipt, reserve stock, update analytics, and refresh a customer view. Putting all of that inside `payOrder()` makes checkout slow and tightly coupled to every future feature.

Instead, checkout records one fact: `order.paid`. Each interested part of the application reacts on its own.

```text
Customer pays
    │
    ▼
Order is marked paid ──► order.paid ──► receipt, inventory, analytics
```

This solves three practical problems:

- Checkout stays focused on taking payment instead of knowing about email, inventory, and analytics.
- A slow email provider does not make a successful payment request fail.
- A new reaction can be added without editing the checkout service.

Events are for completed facts such as `order.paid` or `user.registered`. They are not for a decision that needs an immediate answer, such as “can this payment be captured?” Use a normal service call for that.

## Define the event

Keep the payload small and intentional. Send identifiers and facts a consumer needs—not an ORM object or the whole HTTP request.

```ts
import { EventRegistry, type EventMap } from "starpod";

type AppEvents = EventMap & {
  "order.paid": {
    readonly orderId: string;
    readonly customerId: string;
    readonly totalCents: number;
  };
};

const events = new EventRegistry<AppEvents>();

events.register("order.paid", {
  version: "1",
  encode: (event) => ({ ...event }),
  decode: (value) => validateOrderPaid(value),
});
```

The registry creates a JSON-safe envelope with a name and version. `validateOrderPaid` is application code that checks untrusted broker data before it reaches a handler.

## The production flow

The reliable production path is:

```text
1. Save the order and an outbox record in one database transaction.
2. A background worker publishes committed outbox records to your broker.
3. A consumer handles the broker message, then acknowledges it.
```

The outbox matters because a database write and a broker publish cannot be one atomic operation. Without it, an order could be paid successfully just as publishing `order.paid` fails—and no downstream system would ever know.

```ts
import { EventOutbox } from "starpod";

const outbox = new EventOutbox(events, outboxStore, brokerPublisher);

await prisma.$transaction(async (tx) => {
  const order = await tx.order.update({
    where: { id: orderId },
    data: { status: "PAID" },
  });

  await outbox.enqueue("order.paid", {
    orderId: order.id,
    customerId: order.customerId,
    totalCents: order.totalCents,
  }, { transaction: tx, tenantId });
});
```

Your `outboxStore` writes that record through the supplied transaction. If the transaction fails, neither the order update nor the event is saved. If it succeeds, a worker can safely retry publishing later:

```ts
await outbox.publishPending(100);
```

## Handle the event

The consumer receives a broker message, validates it through the registry, and sends it to typed local handlers.

```ts
import { EventBus, EventConsumer } from "starpod";

const bus = new EventBus<AppEvents>();

bus.on("order.paid", async ({ orderId, customerId, totalCents }, context) => {
  await receipts.send({
    orderId,
    customerId,
    totalCents,
    idempotencyKey: context?.id,
  });
});

const consumer = new EventConsumer(events, bus, {
  idempotency: durableEventIdempotencyStore,
});

await broker.subscribe("domain-events", async (message) => {
  await consumer.consume(parseEventEnvelope(message.body));
  await message.ack();
});
```

Consumers should acknowledge only after handling succeeds. Brokers can redeliver messages after a crash, so production consumers need a shared, durable idempotency store keyed by the event ID. The in-memory store is only for tests and single-process development.

For external services such as email or payments, pass the event ID as that provider’s idempotency key when it supports one. This prevents a retry from becoming a second external action.

## What Starpod provides—and what you provide

| Starpod | Your application |
| --- | --- |
| Typed event names and payload codecs | PostgreSQL/ORM transaction and outbox table |
| Versioned JSON envelopes | Broker: Redis Streams, NATS, RabbitMQ, Kafka, SQS, or another choice |
| Local typed event handlers | Publisher/consumer connection and broker retry policy |
| Outbox and idempotency boundaries | Durable idempotency store and dead-letter handling |

`EventBus` is useful inside one process, especially after a worker receives a message. It is not a durable broker. For an event that follows a database write, use the outbox path above; for a purely local notification, use `EventBus` directly.

That is the whole idea: write the important fact once, deliver it safely in the background, and let new consumers join without turning the original service into a tangle.
