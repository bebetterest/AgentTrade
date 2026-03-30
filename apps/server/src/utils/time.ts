export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class MutableClock implements Clock {
  private current: Date;

  constructor(initial: Date) {
    this.current = initial;
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}

