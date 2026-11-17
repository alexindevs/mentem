export interface BlockLike {
  name: string;
  enabled: boolean;
  startHour: number;
  endHour: number;
}

const STANDARD = ["morning", "afternoon", "evening"];

/** The usual three have an on and off switch; any others you add can be removed. */
export const isStandardBlock = (name: string): boolean => STANDARD.includes(name.trim().toLowerCase());

/** "Block 4", or the first "Block N" no block has yet. */
export function nextBlockName(blocks: BlockLike[]): string {
  const used = new Set(blocks.map((b) => b.name.trim().toLowerCase()));
  for (let n = blocks.length + 1; ; n += 1) if (!used.has(`block ${n}`)) return `Block ${n}`;
}

/**
 * The first whole hour, between waking and bed, that no switched-on block covers. A new block
 * starts there and runs an hour. Null when the day has no room left.
 */
export function freeGap(blocks: BlockLike[], wakeMin: number, bedMin: number): { startHour: number; endHour: number } | null {
  const on = blocks.filter((b) => b.enabled);
  for (let h = Math.ceil(wakeMin / 60); h + 1 <= Math.floor(bedMin / 60); h += 1) {
    if (on.every((b) => h + 1 <= b.startHour || h >= b.endHour)) return { startHour: h, endHour: h + 1 };
  }
  return null;
}

/** Whether two switched-on blocks share a name, ignoring case. */
export function hasDuplicateName(blocks: BlockLike[]): boolean {
  const names = blocks.filter((b) => b.enabled).map((b) => b.name.trim().toLowerCase());
  return new Set(names).size !== names.length;
}
