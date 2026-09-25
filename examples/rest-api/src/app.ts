import { application } from "starpod";
import { users } from "./features/users/users.pod";
import { customer } from "./features/customer/customer.pod";
export const app = application({ features: [users, customer] });
