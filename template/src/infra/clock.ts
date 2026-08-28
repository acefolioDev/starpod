export class Clock {
  now(): string {
    return new Date().toISOString();
  }
}
