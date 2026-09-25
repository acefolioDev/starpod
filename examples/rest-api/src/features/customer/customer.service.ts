import { UserService } from "../users/users.service";

export class CustomerService {
  static readonly inject = [UserService] as const;

  constructor(private readonly users: UserService) {}

  status() {
    return { users: this.users.list().length };
  }
}
