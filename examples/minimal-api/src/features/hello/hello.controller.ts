import type { StarpodElysia } from "starpod";

export class HelloController {
  routes(app: StarpodElysia) {
    return app.get("/", ({ requestId }) => ({ message: "hello", requestId }));
  }
}
