import type Elysia from "elysia";
import type { InjectionToken } from "../di/di";

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";

export type RequestResolver = <T>(token: InjectionToken<T>) => T;
export type AsyncRequestResolver = <T>(token: InjectionToken<T>) => Promise<T>;

export type StarpodSingleton = {
  readonly decorator: {};
  readonly store: {};
  readonly derive: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly resolve: RequestResolver;
    readonly resolveAsync: AsyncRequestResolver;
  };
  readonly resolve: {};
};

/** Native Elysia with Starpod's typed request context. */
export type StarpodElysia = Elysia<string, StarpodSingleton>;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdFrom(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER);
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

/** Read a safe upstream correlation ID, falling back to the request ID. */
export function correlationIdFrom(headers: Headers, fallback: string = crypto.randomUUID()): string {
  const supplied = headers.get(CORRELATION_ID_HEADER);
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : fallback;
}
