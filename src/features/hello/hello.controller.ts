import { HelloService } from "./hello.service";

export class HelloController {
  static readonly needs = [HelloService] as const;

  constructor(private readonly hello: HelloService) {}

  greet() {
    return this.hello.greet();
  }
}
