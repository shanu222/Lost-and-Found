-- How the user's country was last confirmed: 'gps' (live location), 'ip'
-- (country of the internet connection, when location access is blocked) or
-- 'manual' (chosen by the user when neither is available).
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_method text;
UPDATE users SET location_method = 'gps' WHERE location_method IS NULL AND location_verified_at IS NOT NULL;
