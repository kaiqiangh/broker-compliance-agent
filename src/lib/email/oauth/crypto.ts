import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.EMAIL_ENCRYPTION_KEY || '', 'hex');

export function encryptToken(plaintext: string): string {
  if (!KEY || KEY.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decryptToken(ciphertext: string): string {
  if (!KEY || KEY.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
