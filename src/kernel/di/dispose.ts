import { isDisposable } from "./helpers";
import type { InjectionToken } from "./providers";

export async function disposeContainer(options: {
  readonly pending: Map<InjectionToken, Promise<unknown>>;
  readonly initializing: Promise<void> | undefined;
  readonly instances: Map<InjectionToken, unknown>;
  readonly creationOrder: InjectionToken[];
  readonly initializedTokens: Set<InjectionToken>;
}) {
  await Promise.allSettled([...options.pending.values()]);
  await options.initializing?.catch(() => undefined);
  const failures: unknown[] = [];
  for (const token of [...options.creationOrder].reverse()) {
    const instance = options.instances.get(token);
    if (!isDisposable(instance)) continue;
    try {
      await instance.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  options.instances.clear();
  options.pending.clear();
  options.creationOrder.length = 0;
  options.initializedTokens.clear();
  if (failures.length > 0) throw new AggregateError(failures, "container disposal failed");
}
