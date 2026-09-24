import type { StarpodElysia } from "starpod";
import { HelloService } from "./hello.service";

export class HelloController {
  static readonly inject = [HelloService] as const;

  constructor(private readonly hello: HelloService) {}

  routes(app: StarpodElysia) {
    return app.get("/", ({ requestId }) => ({
      ...this.hello.greet(),
      requestId,
    }));
  }
}
