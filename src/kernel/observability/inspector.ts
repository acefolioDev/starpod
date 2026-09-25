export type InspectorEvent = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

export type Inspector = {
  record(event: InspectorEvent): void;
};

export type InspectorRecord = InspectorEvent & {
  readonly recordedAt: number;
};

export type MemoryInspectorOptions = {
  readonly maxEvents?: number;
  readonly now?: () => number;
};

export type InspectorQuery = {
  readonly type?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly limit?: number;
};

/** Bounded, process-local event history for development and tests. */
export class MemoryInspector implements Inspector {
  private readonly history: InspectorRecord[] = [];
  private readonly maxEvents: number;
  private readonly now: () => number;

  constructor(options: MemoryInspectorOptions = {}) {
    this.maxEvents = options.maxEvents ?? 1_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxEvents) || this.maxEvents < 1) {
      throw new Error("MemoryInspector maxEvents must be a positive integer");
    }
  }

  record(event: InspectorEvent) {
    if (!event.type || event.type.includes("\n") || event.type.includes("\r")) {
      throw new Error("Inspector event type must be a non-empty single-line string");
    }
    while (this.history.length >= this.maxEvents) this.history.shift();
    this.history.push(Object.freeze({ ...event, recordedAt: this.now() }));
  }

  snapshot(): readonly InspectorRecord[] {
    return Object.freeze([...this.history]);
  }

  query(options: InspectorQuery = {}): readonly InspectorRecord[] {
    validateQuery(options);
    const matches = this.history.filter((event) =>
      (options.type === undefined || event.type === options.type) &&
      (options.requestId === undefined || event.requestId === options.requestId) &&
      (options.correlationId === undefined || event.correlationId === options.correlationId),
    );
    const limit = options.limit ?? matches.length;
    return Object.freeze(matches.slice(Math.max(0, matches.length - limit)));
  }

  clear() {
    this.history.length = 0;
  }
}

function validateQuery(options: InspectorQuery) {
  for (const [label, value] of [
    ["type", options.type],
    ["requestId", options.requestId],
    ["correlationId", options.correlationId],
  ] as const) {
    if (value !== undefined && (!value || /[\r\n]/.test(value))) {
      throw new Error(`Inspector ${label} must be a non-empty single-line string`);
    }
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("Inspector query limit must be a positive integer");
  }
}
