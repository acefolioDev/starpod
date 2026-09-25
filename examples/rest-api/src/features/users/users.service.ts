import { UserRepository } from "../../infra/user-repository";

export class UserService {
  static readonly inject = [UserRepository] as const;

  constructor(private readonly users: UserRepository) {}

  list() {
    return this.users.list();
  }

  find(id: string) {
    return this.users.find(id);
  }

  create(name: string) {
    return this.users.create(name);
  }
}
