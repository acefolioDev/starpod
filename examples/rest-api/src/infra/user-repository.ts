export type User = {
  readonly id: string;
  readonly name: string;
};

export class UserRepository {
  private readonly users = new Map<string, User>();

  list() {
    return [...this.users.values()];
  }

  find(id: string) {
    return this.users.get(id);
  }

  create(name: string) {
    const user = Object.freeze({ id: crypto.randomUUID(), name });
    this.users.set(user.id, user);
    return user;
  }
}
