import { pod } from "starpod";
import { HelloController } from "./hello.controller";

export const hello = pod({
  name: "hello",
  prefix: "/hello",
  controller: HelloController,
});
