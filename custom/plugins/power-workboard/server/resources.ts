import { readFile } from "node:fs/promises";

/** CUSTOM(resource-pools): the machine's memory, as the kernel reports it. */
export interface MemoryReading {
  availableBytes: number;
  totalBytes: number;
}
/** Reads the memory now; null when this machine can't tell (no `/proc/meminfo`). */
export type MemoryReader = () => Promise<MemoryReading | null>;

/** `MemAvailable` and `MemTotal` from `/proc/meminfo` (values in kB). */
export function parseMeminfo(text: string): MemoryReading | null {
  const field = (name: string) => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, "m").exec(text);
    return match ? Number(match[1]) * 1024 : null;
  };
  const totalBytes = field("MemTotal");
  const availableBytes = field("MemAvailable");
  if (!totalBytes || availableBytes === null) return null;
  return { availableBytes, totalBytes };
}

export const readMemory: MemoryReader = async () => {
  try {
    return parseMeminfo(await readFile("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
};

export function freeRamPercent(reading: MemoryReading): number {
  return Math.round((reading.availableBytes / reading.totalBytes) * 1000) / 10;
}
