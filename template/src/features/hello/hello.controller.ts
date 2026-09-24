import { type AnyElysia } from "elysia";
import { HelloService } from "./hello.service";

export class HelloController {
  static readonly inject = [HelloService] as const;

  constructor(private readonly hello: HelloService) {}

  routes(app: AnyElysia) {
    return app.get("/", () => this.hello.greet());
  }
}
