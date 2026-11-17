/** Splits a command line into words and --flags. A flag may repeat; a bare flag is `true`. */
export interface Parsed {
  words: string[];
  flags: Map<string, string[]>;
}

export function parseArgs(argv: string[]): Parsed {
  const words: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--") || arg === "--") {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).toLowerCase();
    let value: string | undefined = eq === -1 ? undefined : arg.slice(eq + 1);
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      }
    }
    flags.set(name, [...(flags.get(name) ?? []), value ?? ""]);
  }
  return { words, flags };
}

export const flag = (p: Parsed, name: string): string | undefined => p.flags.get(name)?.[p.flags.get(name)!.length - 1];
export const flagAll = (p: Parsed, name: string): string[] => p.flags.get(name) ?? [];
export const has = (p: Parsed, name: string): boolean => p.flags.has(name);
