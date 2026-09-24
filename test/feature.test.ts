import { describe, expect, test } from "bun:test";
import { application, pod } from "../src/kernel/feature";

class Controller {
  routes() {
    return {};
  }
}

const feature = (name: string, prefix: `/${string}` = `/${name}`) =>
  pod({ name, prefix, controller: Controller });

describe("application composition", () => {
  test("requires a feature", () => {
    expect(() => application({ features: [] })).toThrow("Application requires at least one feature");
  });

  test("rejects duplicate feature names and prefixes", () => {
    expect(() => application({ features: [feature("users"), feature("users")] })).toThrow(
      "Duplicate feature name: users",
    );
    expect(() => application({ features: [feature("users", "/api"), feature("orders", "/api")] })).toThrow(
      "Duplicate feature prefix: /api",
    );
  });

  test("rejects duplicate application providers", () => {
    class Database {}

    expect(() => application({ features: [feature("users")], providers: [Database, Database] })).toThrow(
      "Duplicate application provider: Database",
    );
  });

  test("rejects feature names that the architecture seal cannot represent", () => {
    expect(() => feature("user-profile")).toThrow(
      'Feature name must be a single lowercase word (got "user-profile")',
    );
  });
});
