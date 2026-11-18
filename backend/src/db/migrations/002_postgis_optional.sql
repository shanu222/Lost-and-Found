-- Optional PostGIS acceleration.
-- If the PostGIS extension can be installed (Railway's PostGIS template, or
-- any Postgres with postgis available) we add generated geography columns and
-- GiST indexes. If it cannot, this migration is a no-op and the API keeps
-- using bounding-box + haversine queries on lat/lng. Both paths are supported
-- by src/lib/geo.js (it checks `SELECT postgis_version()` at start-up).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS not available — using lat/lng bounding-box queries';
    RETURN;
  END;

  ALTER TABLE found_items  ADD COLUMN IF NOT EXISTS approx_geog geography(Point,4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(approx_lng, approx_lat), 4326)::geography) STORED;
  ALTER TABLE lost_reports ADD COLUMN IF NOT EXISTS geog geography(Point,4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
  ALTER TABLE saved_alerts ADD COLUMN IF NOT EXISTS geog geography(Point,4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;

  CREATE INDEX IF NOT EXISTS found_items_geog_idx  ON found_items  USING gist (approx_geog);
  CREATE INDEX IF NOT EXISTS lost_reports_geog_idx ON lost_reports USING gist (geog);
  CREATE INDEX IF NOT EXISTS saved_alerts_geog_idx ON saved_alerts USING gist (geog);
END $$;
