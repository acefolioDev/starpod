import { Clock } from "@infra/clock";

export class HelloService {
  static readonly inject = [Clock] as const;

  constructor(private readonly clock: Clock) {}

  greet() {
    return {
      from: "hello",
      line: "the service is alive",
      at: this.clock.now(),
    };
  }
}
