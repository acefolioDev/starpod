import { application } from "@kernel/index";
import { hello } from "@features/hello/hello.pod";
import { Clock } from "@infra/clock";

export const app = application({
  features: [hello],
  infra: [Clock],
});
