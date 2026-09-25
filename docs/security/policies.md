# Policies: turn permission into a named decision

## The idea

Roles are coarse labels. Real authorization asks questions like “can this editor update this post in this tenant?” A policy names that decision and puts the resource in the room with the principal.

## How Starpod provides it

Policies are explicit resource-level authorization functions. `definePolicy()` gives each rule a typed principal and resource and throws `FORBIDDEN` when a rule returns false.

```ts
import { definePolicy, type Principal } from "starpod";

type Post = { ownerId: string; published: boolean };
const postPolicy = definePolicy<Principal, Post>({
  read: ({ user, resource }) => resource.published || resource.ownerId === user.id,
  update: ({ user, resource }) => resource.ownerId === user.id,
});

await postPolicy.enforce("update", { user, resource: post });
```

Use policies when access depends on both identity and resource state. Keep them close to domain logic and call them from HTTP handlers, jobs, and event consumers.

## Common mistakes

- Checking only a role and forgetting ownership, tenant, or resource state.
- Authorizing a list endpoint but not each returned resource.
- Returning false silently and leaking whether a resource exists.
- Making policy decisions from unverified request headers.

## Production notes

Policies are application code. Review them like business-critical code, test allow and deny cases, and decide whether unauthorized and not-found should be indistinguishable for your threat model.
