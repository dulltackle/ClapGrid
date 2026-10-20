import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
export type CommandOptions = SpawnOptions & {
  input?: string | Buffer | null;
  timeout?: number;
  signal?: AbortSignal;
  encoding?: BufferEncoding;
  maxBuffer?: number;
};
export type CommandResult = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error: undefined };
export type Command = Promise<CommandResult> & {
  child: ChildProcessWithoutNullStreams;
  stop(): Promise<void>;
  remainingProcesses(): { pid: number; start?: string; boot?: string; pidNamespace?: string }[];
};
export function command(file: string, args: readonly string[], options?: CommandOptions): Command;
export function execCommand(file: string, args: readonly string[], options?: CommandOptions): Promise<CommandResult>;
