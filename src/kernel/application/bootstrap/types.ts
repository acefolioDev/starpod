import type { AnyElysia } from "elysia";
import type { Provider } from "../../di/di";
import type { Inspector } from "../../observability/inspector";
import type { Logger, Metrics, Tracer } from "../../observability/observability";
import type { SecurityHeadersOptions } from "../../security/security";

export type RuntimeEnvironment = "development" | "test" | "production";

export type BootstrapOptions = {
  readonly environment?: RuntimeEnvironment;
  readonly printFeatures?: boolean;
  readonly seal?: boolean;
  readonly overrides?: readonly Provider[];
  readonly configure?: (app: AnyElysia) => AnyElysia;
  readonly logger?: Logger;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  readonly inspector?: Inspector;
  readonly securityHeaders?: false | SecurityHeadersOptions;
  readonly maxRequestBodyBytes?: number;
};
