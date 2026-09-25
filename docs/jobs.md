# Jobs, queues, workers, and schedulers: move work off the request path

## The idea

An HTTP request is a guest at the front desk. It should receive a quick answer, not wait while the kitchen sends an email, rebuilds a search index, and calls three vendors. Jobs move slow or retryable work backstage.

## How Starpod provides it

Jobs are typed work units. Starpod includes an in-memory queue for local work and tests, codec-based envelopes and a `DurableJobDispatcher` boundary for application-owned brokers, `JobWorker` for delivery, and `InMemoryScheduler` for fixed-delay local schedules.

```ts
import { InMemoryJobQueue, exponentialBackoff } from "starpod";

const sendWelcomeEmail = {
  name: "send-welcome-email",
  handle: async (payload: { userId: string }, { attempt, signal }: { attempt: number; signal: AbortSignal }) => {
    await mail.send(payload.userId, { signal });
    console.log(`attempt ${attempt}`);
  },
};

const queue = new InMemoryJobQueue({ concurrency: 4 });
await queue.dispatch(sendWelcomeEmail, { userId: "u_123" }, {
  maxAttempts: 3,
  backoffMs: exponentialBackoff(250),
});
```

The in-memory queue supports delay, priority, retries, cooperative timeouts and cancellation, concurrency, deduplication, progress, and dead letters. A handler must honor `JobContext.signal`. Call `queue.dispose()` during shutdown.

## Durable work

Use a `codec` for payloads crossing process or persistence boundaries. `encodeJob()` creates a transport-safe envelope. `JobRegistry` registers the same definition in a worker, and `JobWorker` maps broker delivery IDs and attempts into handler context. `DurableJobDispatcher` publishes through your adapter; it does not acknowledge or retry behind the adapter’s back.

`JobIdempotencyStore` makes redelivery safe by remembering successful work. The memory implementation is process-local; use a shared atomic store for multiple workers. Pass `tenantId` explicitly when work is tenant-owned.

## Schedules

`InMemoryScheduler` runs fixed-delay, non-overlapping tasks through a `JobQueue`:

```ts
const scheduler = new InMemoryScheduler(queue);
const task = scheduler.schedule(refreshSearch, {}, {
  intervalMs: 60_000,
  runImmediately: true,
});
task.cancel();
```

It is not a durable scheduler or cron engine. Use a deployment scheduler when runs must survive restarts or coordinate across replicas.

## Common mistakes

- Treating the in-memory queue as durable.
- Retrying non-idempotent work without a deduplication key or idempotency store.
- Ignoring `AbortSignal` and delaying shutdown indefinitely.
- Persisting handler functions instead of job names and encoded payloads.

## Production notes

The broker owns durability, visibility timeouts, acknowledgement, retries, worker groups, and dead letters. Design handlers to be idempotent and bounded, and monitor queue age, attempts, failures, and shutdown drain behavior.
