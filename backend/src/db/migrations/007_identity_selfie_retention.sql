-- Identity selfies are deleted once a moderator has reviewed them
-- (Privacy Policy: "Identity photos are deleted after review").
ALTER TABLE identity_checks ALTER COLUMN selfie_key DROP NOT NULL;
