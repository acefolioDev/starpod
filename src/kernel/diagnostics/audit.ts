import { auditArchitecture, type ArchitectureReport } from "../application/architecture";
import type { Application } from "../application/feature";
import { doctor, type DoctorReport } from "./doctor";

export type ProjectAuditOptions = {
  readonly root?: string;
  readonly app?: Application;
  readonly environment?: string;
  readonly strict?: boolean;
};

export type ProjectAuditReport = {
  readonly ok: boolean;
  readonly architecture: ArchitectureReport;
  readonly doctor: DoctorReport;
};

/** Combine architecture and project-risk checks into one CI-friendly report. */
export async function auditProject(options: ProjectAuditOptions = {}): Promise<ProjectAuditReport> {
  const architecture = await auditArchitecture(options.app, { root: options.root });
  const project = await doctor({
    root: options.root,
    environment: options.environment,
    strict: options.strict,
  });
  return Object.freeze({
    ok: architecture.ok && project.ok,
    architecture,
    doctor: project,
  });
}
