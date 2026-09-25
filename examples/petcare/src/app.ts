import { application } from "starpod";
import { events } from "./infra/platform";
import { pets } from "./features/pets/pets.pod";
import { MemoryCache } from "starpod";

export const app = application({
  features: [pets],
  providers: [MemoryCache, events],
});
