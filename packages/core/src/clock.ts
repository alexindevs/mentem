/** Time source. Everything time-dependent takes a Clock so it can be tested without waiting. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class FakeClock implements Clock {
  private t: number;
  constructor(start: number | Date) {
    this.t = typeof start === "number" ? start : start.getTime();
  }
  now(): number {
    return this.t;
  }
  set(t: number | Date): void {
    this.t = typeof t === "number" ? t : t.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
