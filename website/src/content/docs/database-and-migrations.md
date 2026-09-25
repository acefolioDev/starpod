---
title: "Database and migrations: make data ownership boring"
label: "Database and migrations"
description: "Your database is the town archive: valuable, shared, and not something every request should open a new copy of."
section: runtime
order: 20
---

## The idea

Your database is the town archive: valuable, shared, and not something every request should open a new copy of. The hard parts are usually lifecycle, readiness, transactions, and coordinated schema change—not hiding the SQL behind a magical framework.

## How Starpod provides it

Starpod does not bundle an ORM or hide a driver. `DatabaseConnection` is a small lifecycle boundary for an application-owned client: connect, close, ping, and transaction delegation.

```ts
import { DatabaseConnection, provideFactory, token } from "starpod";

type Client = { query(sql: string): Promise<unknown>; close(): Promise<void> };
const DATABASE = token<DatabaseConnection<Client>>("DATABASE");

const database = provideFactory(DATABASE, [], () => new DatabaseConnection({
  connect: () => driver.connect(config.databaseUrl),
  close: (client) => client.close(),
  transaction: (client, work) => driver.transaction(client, work),
  ping: (client) => client.query("select 1"),
}));
```

Repositories use `database.use(...)` or the native client/query builder. Register the connection as an application provider and list `DATABASE` in a feature’s `uses` when that feature consumes it.

## Migrations

`MigrationRunner` provides deterministic ordering and orchestration; your `MigrationStore` provides durable journaling and the deployment-specific lock.

```ts
import { MigrationRunner } from "starpod";

const runner = new MigrationRunner(migrations, migrationStore, database);
await runner.up();
```

Migration IDs are sorted, duplicate or unknown applied IDs are rejected, pending work runs under the store lock, successful steps are recorded, and rollback proceeds in reverse order. Run migrations as a release job or an explicitly coordinated startup task; do not let every replica race without a shared lock.

## Common mistakes

- Assuming `DatabaseConnection` is a driver, pool, ORM, or replica manager.
- Creating a connection per request.
- Running migrations concurrently on every pod.
- Calling a migration “successful” before its journal write is durable.

## Production notes

Choose pool sizing, TLS, credentials, transaction isolation, backups, replicas, schema ownership, and lock semantics in the driver/deployment layer. `ping()` supports readiness but should be cheap and bounded. Treat migration rollback as an application-specific data operation, not a universal undo guarantee.
