-- Stages 2–7 additions.

-- Private identifier the finder enters for IDs / cards / devices (ID number,
-- IMEI, serial). Encrypted; the blind index lets the server compare it with a
-- claimant's answer without ever showing it to anyone.
ALTER TABLE found_items ADD COLUMN IF NOT EXISTS private_id_enc text;
ALTER TABLE found_items ADD COLUMN IF NOT EXISTS private_id_hash text;
ALTER TABLE found_items ADD COLUMN IF NOT EXISTS search_text text;  -- lower-cased description for keyword search
CREATE INDEX IF NOT EXISTS found_items_private_id_idx ON found_items (country_code, private_id_hash) WHERE private_id_hash IS NOT NULL;

ALTER TABLE lost_reports ADD COLUMN IF NOT EXISTS city_id bigint REFERENCES cities(id);
ALTER TABLE lost_reports ADD COLUMN IF NOT EXISTS search_text text;
CREATE INDEX IF NOT EXISTS lost_reports_private_hash_idx ON lost_reports (country_code, private_details_hash) WHERE private_details_hash IS NOT NULL;

-- Handover code: HMAC for checking + encrypted copy so the owner's app can show it.
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS code_enc text;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS finder_id uuid REFERENCES users(id);
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS reward_amount numeric(12,2);
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS reward_currency char(3);
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS story_status text NOT NULL DEFAULT 'visible' CHECK (story_status IN ('visible','hidden'));

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

ALTER TABLE claims ADD COLUMN IF NOT EXISTS reviewed_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS admin_note text;
CREATE UNIQUE INDEX IF NOT EXISTS claims_one_active_per_user_item
  ON claims (found_item_id, claimant_id) WHERE status IN ('pending','follow_up','approved');

ALTER TABLE matches ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE saved_alerts ADD COLUMN IF NOT EXISTS label text;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until timestamptz;

-- Messages: who has read up to where.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS finder_read_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS claimant_read_at timestamptz;

-- Locally stored files (development / when R2 is not configured).
CREATE TABLE IF NOT EXISTS local_files (
  key          text PRIMARY KEY,
  content_type text NOT NULL,
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Overpass (safe places) cache shares geocode_cache.

UPDATE found_items SET search_text = lower(description) WHERE search_text IS NULL;
