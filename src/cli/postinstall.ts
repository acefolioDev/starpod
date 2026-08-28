#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findInstallTarget, scaffold } from "./scaffold";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const target = await findInstallTarget(packageRoot);
if (target) {
  await scaffold(target);
}
