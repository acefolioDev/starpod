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

  clear() {
    this.history.length = 0;
  }
}
