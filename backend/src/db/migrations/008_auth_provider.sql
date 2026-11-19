-- How the user last signed in (Firebase provider: 'google.com' or 'password'),
-- shown in Settings.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text;
