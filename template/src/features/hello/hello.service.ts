import { Clock } from "@infra/clock";
import { HelloAtlas } from "./hello.atlas";

export class HelloService {
  static readonly needs = [Clock] as const;

  constructor(private readonly clock: Clock) {}

  greet() {
    return {
      from: "hello",
      line: "the atlas is lit",
      stars: Object.keys(HelloAtlas.stars),
      at: this.clock.now(),
    };
  }
}
