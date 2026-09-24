import { t } from "elysia";
import type { StarpodElysia } from "../src/kernel";

export class TypedController {
  routes(app: StarpodElysia) {
    return app.get(
      "/users/:id",
      ({ params, requestId }) => {
        const id: string = params.id;
        const trace: string = requestId;
        return { id, trace };
      },
      {
        params: t.Object({ id: t.String() }),
        response: t.Object({ id: t.String(), trace: t.String() }),
      },
    );
  }
}
