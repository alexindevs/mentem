import { randomInt } from "node:crypto";

// Short, human-typable ids: lowercase, no look-alikes (no i, l, o, 0, 1).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function randomId(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** A new id of 4 characters, growing to 5 and then 6 if there are collisions. */
export function newId(exists: (id: string) => boolean): string {
  for (let length = 4; length <= 8; length++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = randomId(length);
      if (!exists(id)) return id;
    }
  }
  throw new Error("Could not generate a unique id");
}
