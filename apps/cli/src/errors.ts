export enum CliExitCode {
  OK = 0,
  VALIDATION = 2,
  CONFIG = 3,
  API = 4,
  NETWORK = 5,
  UNKNOWN = 10
}

export class CliValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliConfigError";
  }
}
