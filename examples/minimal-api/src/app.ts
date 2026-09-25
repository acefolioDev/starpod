import { application } from "starpod";
import { hello } from "./features/hello/hello.pod";

export const app = application({ features: [hello] });
