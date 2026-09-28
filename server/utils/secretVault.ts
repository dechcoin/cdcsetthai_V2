import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

const SECRET_KEY_ENV = 'LIVE_KEYS_ENCRYPTION_KEY';

function getEncryptionKey(): Buffer | null {
  const secret = process.env[SECRET_KEY_ENV] || '';
  if (secret.length < 32) return null;
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function hasSecretEncryptionKey(): boolean {
  return getEncryptionKey() !== null;
}

export function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<EncryptedSecret>;
  return envelope.version === 1
    && envelope.algorithm === 'aes-256-gcm'
    && typeof envelope.iv === 'string'
    && typeof envelope.tag === 'string'
    && typeof envelope.ciphertext === 'string';
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getEncryptionKey();
  if (!key) throw new Error(`${SECRET_KEY_ENV} must contain at least 32 characters`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSecret(envelope: EncryptedSecret): string {
  const key = getEncryptionKey();
  if (!key) throw new Error(`${SECRET_KEY_ENV} is not configured`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
