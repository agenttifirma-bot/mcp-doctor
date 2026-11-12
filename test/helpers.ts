import { fileURLToPath } from "node:url";
import type { CliIo } from "../src/cli.js";

export const NODE = process.execPath;

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export function makeIo(env: Record<string, string> = {}, files: Record<string, string> = {}): CliIo & { out: string; err: string; written: Record<string, string> } {
  const io = {
    out: "",
    err: "",
    written: {} as Record<string, string>,
    stdout: (s: string) => void (io.out += s),
    stderr: (s: string) => void (io.err += s),
    env: { ...(process.env as Record<string, string>), ...env },
    writeFile: (p: string, c: string) => void (io.written[p] = c),
    readFile: (p: string) => {
      if (p in files) return files[p];
      throw new Error("ENOENT");
    },
  };
  return io;
}
