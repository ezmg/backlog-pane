// Base64 both ways: $.fs gives a file's bytes as base64, and Jira's basic
// authentication sends "email:token" as base64. No btoa/atob in a mod.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The bytes of `$.fs.read(…, { as: 'bytes' })`'s base64. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let at = 0
  for (const char of clean) {
    value = (value << 6) | ALPHABET.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[at++] = (value >> bits) & 0xff
    }
  }
  return bytes.subarray(0, at)
}

/** Bytes as base64, padded. */
export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    text += (ALPHABET[(n >> 18) & 63] ?? '') + (ALPHABET[(n >> 12) & 63] ?? '')
    text += i + 1 < bytes.length ? (ALPHABET[(n >> 6) & 63] ?? '') : '='
    text += i + 2 < bytes.length ? (ALPHABET[n & 63] ?? '') : '='
  }
  return text
}
