import { t } from "elysia";
import { NotFound } from "starpod";
import type { StarpodElysia } from "starpod";
import { PetsService } from "./pets.service";

const pet = t.Object({
  id: t.String(),
  name: t.String(),
  species: t.String(),
});

export class PetsController {
  static readonly inject = [PetsService] as const;

  constructor(private readonly pets: PetsService) {}

  routes(app: StarpodElysia) {
    return app
      .get("/", () => this.pets.list(), { response: t.Array(pet) })
      .post("/", async ({ body, set }) => {
        set.status = 201;
        return this.pets.create(body.name, body.species);
      }, {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          species: t.String({ minLength: 1, maxLength: 80 }),
        }),
        response: pet,
      })
      .get("/:id", ({ params }) => {
        const result = this.pets.find(params.id);
        if (!result) throw NotFound("Pet");
        return result;
      }, { params: t.Object({ id: t.String() }), response: pet });
  }
}
