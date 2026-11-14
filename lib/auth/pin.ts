// PIN hashing for the pilot teacher sign-in. Dependency-free (no "server-only")
// so the set-teacher-pin script can use it too.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 } as const;

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function hashPin(pin: string): string {
  if (!isValidPin(pin)) throw new Error("PIN must be 4 to 8 digits");
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !isValidPin(pin)) return false;
  const match = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored);
  if (!match) return false;
  const expected = Buffer.from(match[2], "hex");
  const actual = scryptSync(pin, Buffer.from(match[1], "hex"), SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
}
