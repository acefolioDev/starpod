import { Forbidden } from "./errors";

export type PolicyContext<TPrincipal, TResource> = {
  readonly user: TPrincipal;
  readonly resource: TResource;
};

export type PolicyRule<TPrincipal, TResource> = (
  context: PolicyContext<TPrincipal, TResource>,
) => boolean | Promise<boolean>;

export type Policy<TPrincipal, TResource, TRules extends Record<string, PolicyRule<TPrincipal, TResource>>> = {
  can<TKey extends keyof TRules & string>(
    action: TKey,
    context: PolicyContext<TPrincipal, TResource>,
  ): Promise<boolean>;
  enforce<TKey extends keyof TRules & string>(
    action: TKey,
    context: PolicyContext<TPrincipal, TResource>,
    message?: string,
  ): Promise<void>;
};

export function definePolicy<
  TPrincipal,
  TResource,
  const TRules extends Record<string, PolicyRule<TPrincipal, TResource>> =
    Record<string, PolicyRule<TPrincipal, TResource>>,
>(rules: TRules): Policy<TPrincipal, TResource, TRules> {
  const frozenRules = Object.freeze({ ...rules });
  return Object.freeze({
    async can(action, context) {
      const rule = frozenRules[action];
      if (!rule) throw new Error(`Unknown policy action: ${String(action)}`);
      return Boolean(await rule(context));
    },
    async enforce(action, context, message = "You do not have permission to perform this action") {
      if (!(await this.can(action, context))) throw Forbidden(message);
    },
  });
}
