-- =====================================================================
-- FoundBack — initial schema
--
-- Design rules (see README "Data model"):
--   * Every user-generated row carries country_code and every main table is
--     indexed on it. The API always filters by the requester's country.
--   * Sensitive values (phone numbers, ID numbers, IMEI/serials, hidden
--     answers) are stored AES-256-GCM encrypted (*_enc columns, text
--     "v1:iv:tag:ciphertext"). When we must look a value up or compare it we
--     store a keyed HMAC "blind index" (*_hash) next to it — never the
--     plaintext.
--   * Locations are stored as lat/lng (double precision). If PostGIS is
--     available, migration 002 adds geography columns + GiST indexes; without
--     it the API uses bounding-box + haversine queries on (country_code, lat, lng).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------
-- Countries & languages (admin-editable configuration)
-- ---------------------------------------------------------------------
CREATE TABLE countries (
  code                 char(2) PRIMARY KEY,               -- ISO 3166-1 alpha-2
  name                 text        NOT NULL,
  native_name          text,
  flag                 text        NOT NULL,              -- emoji flag
  enabled              boolean     NOT NULL DEFAULT true,
  dial_codes           text[]      NOT NULL DEFAULT '{}', -- e.g. {92}
  currency             char(3),                           -- ISO 4217
  distance_unit        text        NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  timezones            text[]      NOT NULL DEFAULT '{}',
  default_timezone     text,
  emergency_number     text        NOT NULL DEFAULT '112',
  authority_name       text        NOT NULL DEFAULT 'the local police',
  national_id_name     text        NOT NULL DEFAULT 'National ID/Passport',
  id_mask_pattern      text,                               -- regex used to block ID numbers in public text
  guidance             jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- { ids, documents, cash, general }
  safe_place_types     text[]      NOT NULL DEFAULT '{police,bank,mall,station}',
  bbox                 double precision[],                 -- [minLat, minLng, maxLat, maxLng] (optional fast check)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Languages suggested next to English for each country, in display order.
CREATE TABLE country_languages (
  country_code  char(2) NOT NULL REFERENCES countries(code) ON DELETE CASCADE,
  language      text    NOT NULL,      -- BCP-47 / ISO 639-1 code, e.g. 'ur'
  position      int     NOT NULL DEFAULT 0,
  PRIMARY KEY (country_code, language)
);

-- Cities / regions. Seeded for popular cities; anything a user picks from a
-- Nominatim search is upserted here (source='osm').
CREATE TABLE cities (
  id            bigserial PRIMARY KEY,
  country_code  char(2) NOT NULL REFERENCES countries(code),
  name          text    NOT NULL,
  region        text,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  population    int,
  source        text    NOT NULL DEFAULT 'seed',   -- seed | osm | geonames
  external_id   text,                              -- e.g. 'osm:relation:123'
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, external_id)
);
CREATE INDEX cities_country_name_idx ON cities (country_code, lower(name));

-- ---------------------------------------------------------------------
-- Users & auth
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name           text,
  email                  citext UNIQUE,
  email_verified         boolean     NOT NULL DEFAULT false,
  google_sub             text UNIQUE,
  phone_enc              text,                      -- AES-GCM(E.164)
  phone_hash             text UNIQUE,               -- HMAC(E.164) blind index
  phone_last4            text,                      -- for masked display only
  phone_verified_at      timestamptz,
  country_code           char(2) REFERENCES countries(code),
  city_id                bigint REFERENCES cities(id),
  home_lat               double precision,
  home_lng               double precision,
  home_radius_km         numeric(6,2) DEFAULT 5,
  language               text        NOT NULL DEFAULT 'en',
  timezone               text,
  currency               char(3),
  units                  text        NOT NULL DEFAULT 'km' CHECK (units IN ('km','mi')),
  locale                 text,                      -- formatting locale, e.g. 'en-PK'
  text_dir               text        NOT NULL DEFAULT 'ltr' CHECK (text_dir IN ('ltr','rtl')),
  onboarding_completed_at timestamptz,
  country_changed_at     timestamptz,
  travel_country_code    char(2) REFERENCES countries(code),
  travel_until           timestamptz,
  role                   text        NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  trust_score            int         NOT NULL DEFAULT 0,
  returns_count          int         NOT NULL DEFAULT 0,
  points                 int         NOT NULL DEFAULT 0,
  status                 text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','deleted')),
  banned_reason          text,
  notification_prefs     jsonb       NOT NULL DEFAULT '{"email":true,"push":true,"inapp":true}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
CREATE INDEX users_country_idx ON users (country_code);

-- Refresh tokens: opaque random tokens, stored hashed. Rotation on every use;
-- re-use of a rotated token revokes the whole family (token theft detection).
CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id     uuid NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  rotated_at    timestamptz,
  revoked_at    timestamptz,
  user_agent    text,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE otp_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash    text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('signin','verify_phone')),
  code_hash     text NOT NULL,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,  -- for verify_phone
  attempts      int  NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone_hash, created_at DESC);

-- Optional identity verification (ID number + selfie holding the ID).
CREATE TABLE identity_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code     char(2) NOT NULL REFERENCES countries(code),
  id_number_enc    text NOT NULL,
  id_number_hash   text NOT NULL,
  selfie_key       text NOT NULL,           -- private R2 key
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id      uuid REFERENCES users(id),
  review_note      text,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_checks_country_status_idx ON identity_checks (country_code, status);

-- ---------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------
CREATE TABLE found_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  finder_id        uuid NOT NULL REFERENCES users(id),
  city_id          bigint REFERENCES cities(id),
  category         text NOT NULL,
  description      text NOT NULL,              -- public, screened for contact/ID patterns
  description_lang text NOT NULL DEFAULT 'en',
  lat              double precision NOT NULL,  -- exact point: never returned publicly
  lng              double precision NOT NULL,
  approx_lat       double precision NOT NULL,  -- randomised centre of the ~500 m public circle
  approx_lng       double precision NOT NULL,
  approx_radius_m  int  NOT NULL DEFAULT 500,
  area_label       text,
  found_at         timestamptz NOT NULL,
  current_location text NOT NULL DEFAULT 'with_me' CHECK (current_location IN ('with_me','police','shop_office')),
  current_location_note text,
  no_reward        boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','under_review','approved','returned','closed','removed')),
  reminder_sent_at timestamptz,
  returned_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX found_items_country_status_idx ON found_items (country_code, status, created_at DESC);
CREATE INDEX found_items_country_geo_idx ON found_items (country_code, approx_lat, approx_lng);
CREATE INDEX found_items_finder_idx ON found_items (finder_id);

CREATE TABLE lost_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),  -- home country or travel country
  owner_id         uuid NOT NULL REFERENCES users(id),
  category         text NOT NULL,
  description      text NOT NULL,
  description_lang text NOT NULL DEFAULT 'en',
  lat              double precision NOT NULL,
  lng              double precision NOT NULL,
  radius_m         int  NOT NULL DEFAULT 2000,
  lost_from        timestamptz NOT NULL,
  lost_to          timestamptz NOT NULL,
  private_details_enc text,                   -- IMEI/serial/receipt notes
  private_details_hash text,                  -- blind index of IMEI/serial for exact matching
  reward_amount    numeric(12,2),
  reward_currency  char(3),
  is_travel        boolean NOT NULL DEFAULT false,
  travel_until     timestamptz,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','found','closed','expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lost_reports_country_status_idx ON lost_reports (country_code, status, created_at DESC);
CREATE INDEX lost_reports_country_geo_idx ON lost_reports (country_code, lat, lng);
CREATE INDEX lost_reports_owner_idx ON lost_reports (owner_id);

CREATE TABLE item_photos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  found_item_id    uuid REFERENCES found_items(id) ON DELETE CASCADE,
  lost_report_id   uuid REFERENCES lost_reports(id) ON DELETE CASCADE,
  r2_key           text NOT NULL,
  thumb_key        text NOT NULL,
  is_public        boolean NOT NULL DEFAULT true,   -- false for IDs/cards/documents
  position         int  NOT NULL DEFAULT 0,
  width            int,
  height           int,
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((found_item_id IS NULL) <> (lost_report_id IS NULL))
);
CREATE INDEX item_photos_country_idx ON item_photos (country_code);
CREATE INDEX item_photos_found_idx ON item_photos (found_item_id);
CREATE INDEX item_photos_lost_idx ON item_photos (lost_report_id);

CREATE TABLE hidden_questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  found_item_id    uuid NOT NULL REFERENCES found_items(id) ON DELETE CASCADE,
  country_code     char(2) NOT NULL REFERENCES countries(code),
  question         text NOT NULL,      -- question text is shown to claimants
  answer_enc       text NOT NULL,      -- encrypted, shown only to the finder during review
  position         int  NOT NULL DEFAULT 0
);
CREATE INDEX hidden_questions_item_idx ON hidden_questions (found_item_id);

-- ---------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------
CREATE TABLE claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  found_item_id    uuid NOT NULL REFERENCES found_items(id),
  claimant_id      uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','follow_up','approved','rejected','expired','withdrawn')),
  reject_reason    text,
  follow_up_question text,
  follow_up_answer_enc text,
  id_number_match  boolean,             -- result of server-side ID comparison (never the number)
  flagged          boolean NOT NULL DEFAULT false,
  flag_reasons     text[] NOT NULL DEFAULT '{}',
  decided_at       timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_country_idx ON claims (country_code, status);
CREATE INDEX claims_item_idx ON claims (found_item_id);
CREATE INDEX claims_claimant_idx ON claims (claimant_id, created_at DESC);
-- Only one approved claim per item.
CREATE UNIQUE INDEX claims_one_approved_per_item ON claims (found_item_id) WHERE status = 'approved';

CREATE TABLE claim_answers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES hidden_questions(id) ON DELETE CASCADE,
  answer_enc       text NOT NULL,
  UNIQUE (claim_id, question_id)
);

CREATE TABLE claim_proofs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  country_code     char(2) NOT NULL REFERENCES countries(code),
  kind             text NOT NULL CHECK (kind IN ('serial','photo','receipt','contents','id_number','selfie','text')),
  text_enc         text,                -- serial/IMEI/ID number/free text (encrypted)
  r2_key           text,                -- private image
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_proofs_claim_idx ON claim_proofs (claim_id);

-- ---------------------------------------------------------------------
-- Matching & alerts
-- ---------------------------------------------------------------------
CREATE TABLE matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  found_item_id    uuid NOT NULL REFERENCES found_items(id) ON DELETE CASCADE,
  lost_report_id   uuid NOT NULL REFERENCES lost_reports(id) ON DELETE CASCADE,
  score            numeric(5,2) NOT NULL,
  breakdown        jsonb NOT NULL DEFAULT '{}'::jsonb,
  dismissed_by_owner  boolean NOT NULL DEFAULT false,
  dismissed_by_finder boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (found_item_id, lost_report_id)
);
CREATE INDEX matches_country_idx ON matches (country_code, created_at DESC);

CREATE TABLE saved_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category         text,
  keywords         text,
  lat              double precision NOT NULL,
  lng              double precision NOT NULL,
  radius_m         int  NOT NULL DEFAULT 3000,
  active_until     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_alerts_country_idx ON saved_alerts (country_code, active_until);

-- ---------------------------------------------------------------------
-- Chat & translation
-- ---------------------------------------------------------------------
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  claim_id         uuid NOT NULL UNIQUE REFERENCES claims(id) ON DELETE CASCADE,
  finder_id        uuid NOT NULL REFERENCES users(id),
  claimant_id      uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_country_idx ON conversations (country_code);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  country_code     char(2) NOT NULL REFERENCES countries(code),
  sender_id        uuid NOT NULL REFERENCES users(id),
  body             text NOT NULL,          -- already masked (phones/emails/links removed)
  original_language text NOT NULL DEFAULT 'en',
  was_masked       boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE translations_cache (
  source_hash      text NOT NULL,          -- sha256(source text)
  target_language  text NOT NULL,
  provider         text NOT NULL,
  translated_text  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_hash, target_language)
);

-- ---------------------------------------------------------------------
-- Handover, ratings, reports
-- ---------------------------------------------------------------------
CREATE TABLE handovers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  claim_id         uuid NOT NULL UNIQUE REFERENCES claims(id),
  found_item_id    uuid NOT NULL REFERENCES found_items(id),
  finder_agreed_at  timestamptz,
  owner_agreed_at   timestamptz,
  method           text CHECK (method IN ('meet','courier','collect')),
  place_name       text,
  place_lat        double precision,
  place_lng        double precision,
  place_osm_id     text,
  scheduled_for    timestamptz,
  finder_shares_phone boolean NOT NULL DEFAULT false,
  owner_shares_phone  boolean NOT NULL DEFAULT false,
  code_hash        text,                   -- HMAC of the 6-digit handover code
  code_attempts    int  NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX handovers_country_idx ON handovers (country_code);

CREATE TABLE ratings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  handover_id      uuid NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  rater_id         uuid NOT NULL REFERENCES users(id),
  ratee_id         uuid NOT NULL REFERENCES users(id),
  stars            int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  note             text,
  share_story      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handover_id, rater_id)
);
CREATE INDEX ratings_country_idx ON ratings (country_code);

CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  reporter_id      uuid NOT NULL REFERENCES users(id),
  target_type      text NOT NULL CHECK (target_type IN ('found_item','lost_report','claim','message','user')),
  target_id        uuid NOT NULL,
  reason           text NOT NULL CHECK (reason IN ('scam','fake_claim','abusive','wrong_category','other')),
  details          text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  handled_by       uuid REFERENCES users(id),
  handled_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_country_status_idx ON reports (country_code, status);

-- ---------------------------------------------------------------------
-- Notifications, moderators, audit
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code     char(2) NOT NULL REFERENCES countries(code),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             text NOT NULL,          -- match | new_claim | claim_decision | message | handover_reminder ...
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- i18n params; rendered in the user's language
  read_at          timestamptz,
  emailed_at       timestamptz,
  pushed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_country_idx ON notifications (country_code);

CREATE TABLE push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint         text NOT NULL UNIQUE,
  keys             jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderators (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  country_codes    char(2)[] NOT NULL DEFAULT '{}',
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  country_code     char(2),
  actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  action           text NOT NULL,          -- e.g. auth.signin, user.country_change, claim.approve
  target_type      text,
  target_id        text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- never contains secrets
  ip               inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_country_idx ON audit_log (country_code, created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- Nominatim response cache (search + reverse), shared across instances.
CREATE TABLE geocode_cache (
  cache_key        text PRIMARY KEY,
  response         jsonb NOT NULL,
  expires_at       timestamptz NOT NULL
);
