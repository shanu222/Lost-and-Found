-- User sign-in moves to Firebase Authentication (Google + email/password).
-- Staff keep the built-in password + emailed 2-step login.
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid text;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_idx ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;
DELETE FROM app_settings WHERE key = 'google_client_id';
