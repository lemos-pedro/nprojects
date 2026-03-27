import { createHmac, randomBytes } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.toUpperCase().replace(/=+$/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error('invalid base32 secret');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  return hotp(secret, Math.floor(timestamp / 1000 / 30));
}

export function verifyTotpCode(secret: string, code: string, window = 1, timestamp = Date.now()): boolean {
  const sanitizedCode = code.replace(/\s+/g, '');
  const counter = Math.floor(timestamp / 1000 / 30);

  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, counter + offset) === sanitizedCode) {
      return true;
    }
  }

  return false;
}

export function buildOtpAuthUrl(email: string, secret: string): string {
  const issuer = encodeURIComponent('Ngola Projects');
  const label = encodeURIComponent(`Ngola Projects:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
