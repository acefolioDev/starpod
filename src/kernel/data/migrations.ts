export type Migration<TContext> = {
  readonly id: string;
  readonly up: (context: TContext) => void | Promise<void>;
  readonly down?: (context: TContext) => void | Promise<void>;
};

export type MigrationStore = {
  readonly applied: () => readonly string[] | Promise<readonly string[]>;
  /** Acquire the deployment-specific migration lock for the duration of work. */
  readonly withLock: <TResult>(work: () => Promise<TResult>) => Promise<TResult>;
  readonly markApplied: (id: string) => void | Promise<void>;
  readonly markReverted: (id: string) => void | Promise<void>;
};

export type MigrationStatus = {
  readonly applied: readonly string[];
  readonly pending: readonly string[];
};

/**
 * Deterministic migration orchestration over an application-owned journal.
 * The store decides how locking and persistence work for the chosen database.
 */
export class MigrationRunner<TContext> {
  private readonly migrations: readonly Migration<TContext>[];
  private readonly byId: ReadonlyMap<string, Migration<TContext>>;

  constructor(
    migrations: readonly Migration<TContext>[],
    private readonly store: MigrationStore,
    private readonly context: TContext,
  ) {
    this.migrations = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
    const byId = new Map<string, Migration<TContext>>();
    for (const migration of this.migrations) {
      validateMigrationId(migration.id);
      if (byId.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
      byId.set(migration.id, migration);
    }
    this.byId = byId;
  }

  async status(): Promise<MigrationStatus> {
    const applied = await this.readApplied();
    const appliedSet = new Set(applied);
    return Object.freeze({
      applied: Object.freeze(applied),
      pending: Object.freeze(this.migrations
        .filter((migration) => !appliedSet.has(migration.id))
        .map((migration) => migration.id)),
    });
  }

  async up(): Promise<readonly string[]> {
    return this.store.withLock(async () => {
      const applied = await this.readApplied();
      const appliedSet = new Set(applied);
      const completed: string[] = [];

      for (const migration of this.migrations) {
        if (appliedSet.has(migration.id)) continue;
        await migration.up(this.context);
        await this.store.markApplied(migration.id);
        completed.push(migration.id);
        appliedSet.add(migration.id);
      }

      return Object.freeze(completed);
    });
  }

  async down(steps = 1): Promise<readonly string[]> {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new Error("Migration rollback steps must be a positive integer");
    }

    return this.store.withLock(async () => {
      const applied = await this.readApplied();
      const selected = applied.slice(-steps).reverse();
      const migrations = selected.map((id) => this.byId.get(id));
      if (migrations.some((migration) => !migration?.down)) {
        const missing = selected.find((id) => !this.byId.get(id)?.down);
        throw new Error(`Migration ${missing} does not define down()`);
      }

      const reverted: string[] = [];
      for (const migration of migrations) {
        if (!migration?.down) continue;
        await migration.down(this.context);
        await this.store.markReverted(migration.id);
        reverted.push(migration.id);
      }
      return Object.freeze(reverted);
    });
  }

  private async readApplied() {
    const applied = [...await this.store.applied()];
    const known = new Set<string>();
    let firstIndex = -1;
    let previousIndex = -1;
    for (const id of applied) {
      validateMigrationId(id);
      const migrationIndex = this.migrations.findIndex((migration) => migration.id === id);
      if (migrationIndex === -1) throw new Error(`Applied migration is not registered: ${id}`);
      if (known.has(id)) throw new Error(`Duplicate applied migration id: ${id}`);
      if (migrationIndex < previousIndex) {
        throw new Error(`Applied migrations are out of order: ${id}`);
      }
      if (previousIndex >= 0 && migrationIndex !== previousIndex + 1) {
        throw new Error(`Applied migrations have a gap before: ${id}`);
      }
      if (firstIndex === -1) firstIndex = migrationIndex;
      known.add(id);
      previousIndex = migrationIndex;
    }
    if (firstIndex > 0) throw new Error(`Applied migrations have a gap before: ${applied[0]}`);
    return applied;
  }
}

function validateMigrationId(id: string) {
  if (!id || id.includes("\n") || id.includes("\r")) {
    throw new Error("Migration id must be a non-empty single-line string");
  }
}
