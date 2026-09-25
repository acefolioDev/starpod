import { pod } from "starpod";
import { CustomerController } from "./customer.controller";
import { CustomerService } from "./customer.service";
import { users } from "../users/users.pod";

export const customer = pod({
  name: "customer",
  prefix: "/customer",
  controller: CustomerController,
  imports: [users],
  providers: [CustomerService],
});
