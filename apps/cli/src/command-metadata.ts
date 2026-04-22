import type { Command } from "commander";

const INPUT_CONTRACT_LINES = Symbol("inputContractLines");

type CommandWithMetadata = Command & {
  [INPUT_CONTRACT_LINES]?: readonly string[];
};

export const setInputContractLines = (command: Command, lines: readonly string[]): void => {
  const nextLines = [...lines];
  Object.defineProperty(command as CommandWithMetadata, INPUT_CONTRACT_LINES, {
    value: nextLines,
    configurable: true,
    enumerable: false,
    writable: false
  });
};

export const getInputContractLines = (command: Command): readonly string[] => {
  return [...((command as CommandWithMetadata)[INPUT_CONTRACT_LINES] ?? [])];
};
