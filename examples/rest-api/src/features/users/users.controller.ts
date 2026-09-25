import { t } from "elysia";
import { NotFound } from "starpod";
import type { StarpodElysia } from "starpod";
import { UserService } from "./users.service";

const user = t.Object({ id: t.String(), name: t.String() });

export class UsersController {
  static readonly inject = [UserService] as const;

  constructor(private readonly service: UserService) {}

  routes(app: StarpodElysia) {
    return app
      .get("/", () => this.service.list(), { response: t.Array(user) })
      .post("/", ({ body, set }) => {
        set.status = 201;
        return this.service.create(body.name);
      }, {
        body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }),
        response: user,
      })
      .get("/:id", ({ params }) => {
        const result = this.service.find(params.id);
        if (!result) throw NotFound("User");
        return result;
      }, {
        params: t.Object({ id: t.String() }),
        response: user,
      });
  }
}
