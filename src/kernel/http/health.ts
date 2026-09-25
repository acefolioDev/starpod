import { t, type AnyElysia } from "elysia";

export type HealthCheck = {
  readonly name: string;
  readonly check: (signal: AbortSignal) => void | Promise<void>;
  readonly timeoutMs?: number;
};

export type HealthRoutesOptions = {
  readonly livenessPath?: `/${string}`;
  readonly readinessPath?: `/${string}`;
  readonly checks?: readonly HealthCheck[];
};

export function healthRoutes(app: AnyElysia, options: HealthRoutesOptions = {}) {
  const livenessPath = options.livenessPath ?? "/health/live";
  const readinessPath = options.readinessPath ?? "/health/ready";
  const checks = options.checks ?? [];
  const names = new Set<string>();

  for (const check of checks) {
    if (names.has(check.name)) throw new Error(`Duplicate health check: ${check.name}`);
    if (check.timeoutMs !== undefined && (!Number.isFinite(check.timeoutMs) || check.timeoutMs <= 0)) {
      throw new Error(`Health check timeoutMs must be a positive number: ${check.name}`);
    }
    names.add(check.name);
  }

  app.get(livenessPath, () => ({ status: "ok" as const }), {
    response: t.Object({ status: t.Literal("ok") }),
  });
  return app.get(readinessPath, async ({ set }) => {
    const outcomes = await Promise.all(checks.map(async (check) => {
      try {
        await runCheck(check);
        return [check.name, { status: "ok" as const }] as const;
      } catch {
        return [check.name, { status: "failed" as const }] as const;
      }
    }));
    const results = Object.fromEntries(outcomes) as Record<string, { readonly status: "ok" | "failed" }>;
    const ready = outcomes.every(([, result]) => result.status === "ok");

    if (!ready) set.status = 503;
    return {
      status: ready ? ("ok" as const) : ("not_ready" as const),
      checks: results,
    };
  }, {
    response: t.Object({
      status: t.Union([t.Literal("ok"), t.Literal("not_ready")]),
      checks: t.Record(t.String(), t.Object({
        status: t.Union([t.Literal("ok"), t.Literal("failed")]),
      })),
    }),
  });
}

async function runCheck(check: HealthCheck) {
  const controller = new AbortController();
  const task = Promise.resolve().then(() => check.check(controller.signal));
  if (check.timeoutMs === undefined) {
    await task;
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`health check timed out after ${check.timeoutMs}ms`));
        }, check.timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
