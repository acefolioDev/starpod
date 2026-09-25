import { pod } from "starpod";
import { PetsController } from "./pets.controller";
import { PetsService } from "./pets.service";

export const pets = pod({
  name: "pets",
  prefix: "/pets",
  controller: PetsController,
  providers: [PetsService],
});
