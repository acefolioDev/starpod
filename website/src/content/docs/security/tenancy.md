---
title: "Tenancy: keep neighborhoods from sharing mail"
label: "Tenancy"
description: "In a multi-tenant system, “the current customer” is part of almost every decision."
section: security
order: 70
---

## The idea

In a multi-tenant system, “the current customer” is part of almost every decision. A tenant ID floating around in an untyped header is easy to forget; a tenant context makes the decision visible, but it still must be checked against identity and data access.

## How Starpod provides it

`tenancy()` resolves an explicit tenant from a request and exposes a typed `tenant` value to native Elysia handlers. It does not automatically isolate database rows or authorize cross-tenant access.

```ts
import { tenancy, type TenantElysia } from "starpod";

const tenantPlugin = tenancy((request) => {
  const id = request.headers.get("x-tenant-id");
  return id ? { id } : null;
}, { required: true });

const server = await bootstrap(app, {
  configure: (elysia) => tenantPlugin(elysia),
});

class ReportsController {
  routes(app: TenantElysia) {
    return app.get("/", ({ tenant }) => ({ tenantId: tenant.id }));
  }
}
```

Use `tenantKey(tenant.id, key)` for namespaced cache/lock keys and `tenantCache(cache, tenant)` for a tenant-scoped cache view.

## Common mistakes

- Trusting a client tenant header without binding it to the authenticated principal.
- Forgetting tenant predicates in repositories, jobs, and event consumers.
- Using raw IDs as shared cache or lock keys.
- Assuming typed context enforces authorization.

## Production notes

Resolve tenants from a verified identity or trusted routing layer, enforce membership and resource access, isolate database queries, and carry tenant IDs explicitly into async work. Test that cross-tenant reads and writes fail.
