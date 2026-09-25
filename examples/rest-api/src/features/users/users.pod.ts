import { pod } from "starpod";
import { UserRepository } from "../../infra/user-repository";
import { UsersController } from "./users.controller";
import { UserService } from "./users.service";

export const users = pod({
  name: "users",
  prefix: "/users",
  controller: UsersController,
  providers: [UserRepository, UserService],
  exports: [UserService],
});
