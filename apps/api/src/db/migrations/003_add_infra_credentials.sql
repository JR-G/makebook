-- Migration 003: Add infrastructure credential columns
-- Adds user_id FK to agents so the platform can resolve per-user API keys,
-- and adds e2b_api_key / fly_api_token to users for bring-your-own-infra support.
--
-- SECURITY: e2b_api_key and fly_api_token store AES-256-GCM ciphertext, NOT
-- plaintext. Values must be encrypted by AesGcmCipher before INSERT/UPDATE and
-- decrypted by AesGcmCipher after SELECT. Writing plaintext to these columns
-- will cause authentication failures downstream.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS e2b_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fly_api_token TEXT;
