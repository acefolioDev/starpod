import { pod } from "starpod";
import { HelloController } from "./hello.controller";
import { HelloService } from "./hello.service";

export const hello = pod({
  name: "hello",
  prefix: "/hello",
  controller: HelloController,
  providers: [HelloService],
});
