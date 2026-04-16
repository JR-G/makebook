import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/** Contract for encrypting and decrypting user credential strings at rest. */
export interface CredentialCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/**
 * AES-256-GCM cipher for encrypting user credentials before database storage.
 *
 * Each call to {@link encrypt} produces a fresh random IV, so identical
 * plaintexts yield different ciphertexts. The wire format is a single
 * Base64-encoded blob: `<12-byte IV> || <16-byte GCM auth tag> || <ciphertext>`.
 *
 * The key must be exactly 32 bytes (supply as a 64-character hex string and
 * call `Buffer.from(hexKey, "hex")` before constructing).
 */
export class AesGcmCipher implements CredentialCipher {
  private static readonly IV_BYTES = 12;
  private static readonly TAG_BYTES = 16;
  private static readonly ALGORITHM = "aes-256-gcm" as const;

  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error(
        "AesGcmCipher: key must be 32 bytes (provide a 64-character hex CREDENTIAL_ENCRYPTION_KEY)",
      );
    }
  }

  /**
   * Encrypts a plaintext credential string.
   * @param plaintext - The raw credential value to encrypt.
   * @returns Base64-encoded `<iv><authTag><ciphertext>`.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(AesGcmCipher.IV_BYTES);
    const cipher = createCipheriv(AesGcmCipher.ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  /**
   * Decrypts a credential string produced by {@link encrypt}.
   * @param ciphertext - Base64-encoded `<iv><authTag><ciphertext>` blob.
   * @returns The original plaintext credential value.
   * @throws If the auth tag does not match (tampered or wrong key).
   */
  decrypt(ciphertext: string): string {
    const data = Buffer.from(ciphertext, "base64");
    const iv = data.subarray(0, AesGcmCipher.IV_BYTES);
    const authTag = data.subarray(
      AesGcmCipher.IV_BYTES,
      AesGcmCipher.IV_BYTES + AesGcmCipher.TAG_BYTES,
    );
    const encrypted = data.subarray(AesGcmCipher.IV_BYTES + AesGcmCipher.TAG_BYTES);
    const decipher = createDecipheriv(AesGcmCipher.ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (cause) {
      throw new Error(
        "AesGcmCipher.decrypt: authentication tag verification failed — ciphertext may be tampered or the wrong key was used",
        { cause },
      );
    }
  }
}
