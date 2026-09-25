import { observeOperation, type OperationTelemetry } from "../observability/operation";
import {
  encodeJob,
  type JobDefinition,
  type JobEnvelope,
  type JobEvent,
  type JobObserver,
  type JobOptions,
  type JobReceipt,
} from "./contracts";

export type JobEnvelopePublisher = {
  publish(envelope: JobEnvelope): Promise<JobReceipt>;
};

export type DurableJobDispatcherOptions = OperationTelemetry & {
  readonly onEvent?: JobObserver;
};

/** Encode typed jobs before handing them to an application-owned durable transport. */
export class DurableJobDispatcher {
  constructor(
    private readonly publisher: JobEnvelopePublisher,
    private readonly options: DurableJobDispatcherOptions = {},
  ) {}

  async dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options: JobOptions = {},
  ): Promise<JobReceipt> {
    return observeOperation(this.options, "jobs.dispatch", async () => {
      const envelope = encodeJob(job, payload, options);
      const receipt = await this.publisher.publish(envelope);
      if (!receipt || receipt.name !== envelope.name || !receipt.id) {
        throw new Error(`durable publisher returned an invalid receipt for job "${envelope.name}"`);
      }
      observeDispatch(this.options.onEvent, receipt);
      return receipt;
    }, { "job.name": job.name });
  }
}

function observeDispatch(observer: JobObserver | undefined, receipt: JobReceipt) {
  try {
    observer?.({ operation: "dispatch", id: receipt.id, name: receipt.name });
  } catch {
    // Durable job telemetry must not change publisher correctness.
  }
}
