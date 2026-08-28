import { pod } from "@kernel/index";
import { HelloAtlas } from "./hello.atlas";
import { HelloController } from "./hello.controller";
import { HelloService } from "./hello.service";

export const hello = pod({
  atlas: HelloAtlas,
  controller: HelloController,
  register: [HelloService],
});
