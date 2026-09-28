import { Injectable } from '@nestjs/common';

import { CredentialEncryptionService } from '../../security/credential-encryption.service.js';

/** Encrypts provider credentials at rest using ezRepo's shared credential service. */
@Injectable()
export class ProviderCredentialService {
  /**
   * Initialize ProviderCredentialService with its required dependencies.
   *
   * @param credentials - Service encrypting and decrypting persisted credentials.
   */
  constructor(private readonly credentials: CredentialEncryptionService) {}

  /**
   * Encrypt a provider credential without retaining or logging its plaintext.
   *
   * @param plaintext - Secret value to encrypt without retaining or logging it.
   * @returns A versionless IV, authentication-tag, and ciphertext envelope encoded with base64url.
   */
  encrypt(plaintext: string): string {
    return this.credentials.encrypt(plaintext);
  }

  /**
   * Decrypt a credential stored by {@link encrypt}.
   *
   * @param encrypted - Authenticated encrypted credential envelope stored by the application.
   * @returns The authenticated plaintext credential.
   * @throws Error - When the encrypted envelope is malformed or fails authentication with the configured key.
   */
  decrypt(encrypted: string): string {
    return this.credentials.decrypt(encrypted);
  }
}
