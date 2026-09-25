import { Elysia } from "elysia";
import { Container, MemoryCache } from "../src/kernel";

type BenchmarkResult = {
  readonly name: string;
  readonly iterations: number;
  readonly elapsedMs: number;
  readonly operationsPerSecond: number;
  readonly averageMicroseconds: number;
};

const iterations = readIterations();
const server = new Elysia().get("/health", () => ({ status: "ok" }));
const cache = new MemoryCache();
cache.set("key", { value: "cached" });
class Service {}
const container = new Container([Service]);

const cases: readonly [string, () => void | Promise<void>][] = [
  ["elysia.request", async () => {
    await server.handle(new Request("http://benchmark.test/health"));
  }],
  ["starpod.di.resolve", () => {
    container.resolve(Service);
  }],
  ["starpod.cache.get", () => {
    cache.get<{ value: string }>("key");
  }],
];
const results: BenchmarkResult[] = [];
for (const [name, operation] of cases) results.push(await benchmark(name, operation));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log("Benchmark results (environment-specific; not a release gate)\n");
  for (const result of results) {
    console.log(`${result.name.padEnd(24)} ${result.operationsPerSecond.toFixed(0)} ops/s  ${result.averageMicroseconds.toFixed(2)} µs/op`);
  }
}

async function benchmark(name: string, operation: () => void | Promise<void>): Promise<BenchmarkResult> {
  for (let index = 0; index < Math.min(100, iterations); index += 1) await operation();
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) await operation();
  const elapsedMs = Math.max(0.001, performance.now() - startedAt);
  return {
    name,
    iterations,
    elapsedMs: round(elapsedMs),
    operationsPerSecond: round(iterations * 1_000 / elapsedMs),
    averageMicroseconds: round(elapsedMs * 1_000 / iterations),
  };
}

function readIterations() {
  const value = Number(Bun.env.STARPOD_BENCH_ITERATIONS ?? 10_000);
  if (!Number.isInteger(value) || value < 100 || value > 1_000_000) {
    throw new Error("STARPOD_BENCH_ITERATIONS must be an integer from 100 through 1000000");
  }
  return value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
