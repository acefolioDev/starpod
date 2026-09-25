import { describe, expect, test } from "bun:test";
import { BadRequest, InternalServerError, NotFound, serializeError, StarpodError } from "../src/kernel/errors/errors";

describe("errors", () => {
  test("serializes a safe application error", () => {
    const result = serializeError(NotFound("User"), { requestId: "req-1" });

    expect(result.status).toBe(404);
    expect(result.payload).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "User not found",
        requestId: "req-1",
      },
    });
  });

  test("exposes explicitly safe validation details", () => {
    const result = serializeError(BadRequest("Invalid input", { field: "email" }));

    expect(result.payload.error.details).toEqual({ field: "email" });
  });

  test("redacts sensitive and non-serializable validation details", () => {
    const details: Record<string, unknown> = {
      field: "email",
      password: "do-not-return",
      nested: { authorization: "Bearer secret", query: "select * from users" },
      count: BigInt(2),
    };
    details.self = details;

    const result = serializeError(BadRequest("Invalid input", details));

    expect(result.payload.error.details).toEqual({
      field: "email",
      password: "[REDACTED]",
      nested: { authorization: "[REDACTED]", query: "[REDACTED]" },
      count: "2n",
      self: "[CIRCULAR]",
    });
    expect(() => JSON.stringify(result.payload)).not.toThrow();
  });

  test("bounds exposed validation arrays", () => {
    const result = serializeError(BadRequest("Invalid input", Array.from({ length: 105 }, (_, index) => index)));
    const details = result.payload.error.details as readonly unknown[];

    expect(details).toHaveLength(101);
    expect(details.at(-1)).toBe("[TRUNCATED]");
  });

  test("hides unexpected error details in production responses", () => {
    const result = serializeError(new Error("database password=secret"));

    expect(result.status).toBe(500);
    expect(result.payload).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  test("adds diagnostics only in development", () => {
    const result = serializeError(InternalServerError(new Error("debug detail")), {
      development: true,
    });

    expect(result.payload.error).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    });
  });

  test("maps native Elysia validation errors to a client error", () => {
    const result = serializeError({
      code: "VALIDATION",
      status: 422,
      message: "sensitive validation details",
    });

    expect(result).toEqual({
      status: 422,
      payload: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
        },
      },
    });
  });

  test("rejects invalid public error statuses", () => {
    expect(() => new StarpodError({ status: 200, code: "INVALID", message: "bad" })).toThrow("HTTP error status");
    expect(() => new StarpodError({ status: 500, code: "bad\ncode", message: "bad" })).toThrow("single-line");
    expect(() => new StarpodError({ status: 400, code: "INVALID", message: "x".repeat(2_049) })).toThrow("2048");
  });
});
