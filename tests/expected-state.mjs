const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const STATE_LENGTH = 8;
const REJECTION_FLOOR = 248;

export function generateState(readByte) {
  if (typeof readByte !== "function") {
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
      throw new Error("CSPRNG unavailable");
    }
    const bytes = new Uint8Array(32);
    let index = bytes.length;
    readByte = function () {
      if (index >= bytes.length) {
        globalThis.crypto.getRandomValues(bytes);
        index = 0;
      }
      const value = bytes[index];
      index += 1;
      return value;
    };
  }
  let out = "";
  while (out.length < STATE_LENGTH) {
    const bite = readByte();
    if (!Number.isInteger(bite) || bite < 0 || bite > 255) {
      throw new Error("state byte out of range");
    }
    if (bite >= REJECTION_FLOOR) continue;
    out += ALPHABET[bite % ALPHABET.length];
  }
  return out;
}
