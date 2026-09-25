import type { StarpodElysia } from "starpod";
import { CustomerService } from "./customer.service";

export class CustomerController {
  static readonly inject = [CustomerService] as const;

  constructor(private readonly service: CustomerService) {}

  routes(app: StarpodElysia) {
    return app.get("/", () => ({ status: "ok", feature: "customer", ...this.service.status() }));
  }
}
