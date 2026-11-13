#!/usr/bin/env node
// Synthetic-only encryption/integrity drill; NEVER pass a production backup.
import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const [plainPath, encryptedPath, decryptedPath] = process.argv.slice(2);
if (!plainPath || !encryptedPath || !decryptedPath ||
    [plainPath, encryptedPath, decryptedPath].some((p) => !p.includes('.xsgym-synthetic-restore.'))) {
  throw new Error('REFUSE: only files inside the temporary synthetic recovery directory are allowed');
}
const plaintext = readFileSync(plainPath);
const key = randomBytes(32); // ephemeral, in memory only; NOT a production key
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const packed = Buffer.concat([Buffer.from('XS-SYN-1'), iv, tag, ciphertext]);
writeFileSync(encryptedPath, packed, { mode: 0o600 });

function decrypt(blob) {
  assert.equal(blob.subarray(0, 8).toString(), 'XS-SYN-1', 'bad envelope magic');
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(8, 20));
  decipher.setAuthTag(blob.subarray(20, 36));
  return Buffer.concat([decipher.update(blob.subarray(36)), decipher.final()]);
}
const restoredBytes = decrypt(readFileSync(encryptedPath));
const hash = (buf) => createHash('sha256').update(buf).digest();
assert(timingSafeEqual(hash(plaintext), hash(restoredBytes)), 'backup ciphertext round-trip mismatch');
writeFileSync(decryptedPath, restoredBytes, { mode: 0o600 });

const tampered = Buffer.from(packed);
tampered[tampered.length - 1] ^= 1;
assert.throws(() => decrypt(tampered), /authenticat|decrypt|Unsupported state|bad decrypt/i);
console.log('PASS: ephemeral AES-256-GCM encrypted synthetic dump round trip, SHA-256 integrity and tamper rejection');
console.log('Not a test of live backups, off-site storage, key escrow, retention or automated recoverability.');
