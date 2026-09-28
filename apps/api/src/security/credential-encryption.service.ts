import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ENV } from '../config/env.js';

/** Encrypts application credentials at rest using the configured AES-256-GCM key. */
@Injectable()
export class CredentialEncryptionService {
  private readonly key = Buffer.from(ENV.TOKEN_ENCRYPTION_KEY, 'base64');

  /**
   * Encrypt a credential without retaining or logging its plaintext.
   *
   * @param plaintext - Secret value to encrypt without retaining or logging it.
   * @returns A versionless IV, authentication-tag, and ciphertext envelope encoded with base64url.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(
      '.',
    );
  }

  /**
   * Decrypt a credential stored by {@link encrypt}.
   *
   * @param encrypted - Authenticated encrypted credential envelope stored by the application.
   * @returns The authenticated plaintext credential.
   * @throws Error - When the encrypted envelope is malformed or fails authentication with the configured key.
   */
  decrypt(encrypted: string): string {
    const [ivValue, tagValue, ciphertextValue, extra] = encrypted.split('.');
    if (!ivValue || !tagValue || !ciphertextValue || extra) throw new Error('Invalid encrypted credential.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  }
}
