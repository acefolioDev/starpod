import { describe, expect, test } from "bun:test";
import { application, pod } from "../src/kernel/application/feature";
import { plugin } from "../src/kernel/application/plugins";

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

  test("rejects a plugin provider that conflicts with an application provider", () => {
    class Database {}
    const extension = plugin({ name: "database", providers: [Database], configure: (app) => app });

    expect(() => application({ features: [feature("users")], providers: [Database], plugins: [extension] }))
      .toThrow("Duplicate application provider: Database");
  });

  test("rejects ambiguous legacy and current provider options", () => {
    class Database {}

    expect(() => application({
      features: [feature("users")],
      providers: [Database],
      infra: [Database],
    })).toThrow("application.providers or deprecated application.infra, not both");
  });

  test("rejects duplicate feature providers before bootstrap", () => {
    class Database {}

    expect(() => pod({
      name: "users",
      prefix: "/users",
      controller: Controller,
      uses: [Database],
      providers: [Database],
    })).toThrow("Duplicate feature provider: Database");
  });

  test("rejects feature names that the architecture seal cannot represent", () => {
    expect(() => feature("user-profile")).toThrow(
      'Feature name must be a single lowercase word (got "user-profile")',
    );
  });
});
