-- Admin login, live app settings (editable in the admin panel) and live location.

-- Settings that the admin panel can change at runtime. Plain values live in
-- `value` (jsonb); API keys and other secrets are AES-256-GCM encrypted in
-- `secret_enc` and are never returned in full by the API.
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb,
  secret_enc  text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Staff sign-in with email + password (+ emailed 2-step code).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Live location: the user's country is decided by the device's GPS, which a
-- VPN cannot change. The exact point is kept only as the latest check.
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_lat double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_lng double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_accuracy_m int;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_country char(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_country char(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vpn_flagged_at timestamptz;

-- otp_codes is reused for the admin 2-step code.
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check CHECK (purpose IN ('signin','verify_phone','admin_2fa'));
