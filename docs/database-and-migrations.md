# Bring your own ORM

## The idea

Persistence is application infrastructure. Mature tools already own the hard parts: connection management, queries, transactions, schemas, and migrations. Starpod stays out of that domain so the application can choose Prisma, Drizzle, Kysely, or a native driver without a second abstraction layer.

## How it fits Starpod

Register the selected client as an application-scoped provider. Providers with `initialize()` and `dispose()` participate in Starpod's lifecycle; services then use the native client directly.

```ts
import { PrismaClient } from "@prisma/client";

export class PrismaDatabase {
  readonly client = new PrismaClient();

  initialize() {
    return this.client.$connect();
  }

  dispose() {
    return this.client.$disconnect();
  }
}
```

Register `PrismaDatabase` in `application({ providers })`, inject it into the services that need it, and call `database.client.user.findMany()` or Prisma's normal transaction API. The same pattern works for any other client.

## Schema and migrations

The selected persistence tool owns schema and migrations. For example, Prisma owns `schema.prisma`, generated types, and its migration history; Drizzle owns its TypeScript schema and generated SQL migrations. Run the tool's migration command once as a coordinated release task before application replicas start.

## Common mistakes

- Creating a client per request instead of one application-scoped client per process.
- Defining the same schema or migration in two systems.
- Running the ORM's migration command concurrently on every replica.
- Hiding ORM queries behind a generic repository that removes the ORM's useful capabilities.

## Production notes

Choose pool sizing, TLS, credentials, transaction isolation, backups, replicas, schema ownership, and lock semantics in the ORM, driver, and deployment layer. Keep migration rollback an application-specific data operation, not a universal undo guarantee.
