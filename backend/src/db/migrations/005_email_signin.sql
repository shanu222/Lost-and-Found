-- Sign-in moves from SMS to emailed codes (+ Google). Phone columns are kept
-- so old data can still be exported/erased, but nothing writes them any more.
ALTER TABLE otp_codes RENAME COLUMN phone_hash TO subject_hash;
ALTER INDEX IF EXISTS otp_codes_phone_idx RENAME TO otp_codes_subject_idx;
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('signin','verify_phone','admin_2fa','signin_email'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at) WHERE email_verified AND email IS NOT NULL;

-- At handover, people may now reveal their email (instead of a phone number).
ALTER TABLE handovers RENAME COLUMN finder_shares_phone TO finder_shares_email;
ALTER TABLE handovers RENAME COLUMN owner_shares_phone  TO owner_shares_email;

-- SMS settings no longer exist.
DELETE FROM app_settings WHERE key IN ('sms_provider','twilio_account_sid','twilio_auth_token','twilio_from');
