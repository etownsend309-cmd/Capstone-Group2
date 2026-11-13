CREATE TABLE agreement_ingestions (
  agreement_id uuid NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed')),
  source text NOT NULL DEFAULT 'extracted' CHECK (source IN ('extracted', 'supplied')),
  source_text text NOT NULL DEFAULT '' CHECK (length(source_text) <= 2000000),
  pages jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(pages) = 'array'),
  segments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(segments) = 'array'),
  page_count integer CHECK (page_count > 0),
  strategy text,
  warnings text[] NOT NULL DEFAULT '{}',
  source_hash text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agreement_id, version),
  CHECK (state <> 'ready' OR (btrim(source_text) <> '' AND jsonb_array_length(segments) > 0 AND source_hash IS NOT NULL)),
  CHECK ((state = 'failed') = (error IS NOT NULL))
);

ALTER TABLE agreement_ingestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ingestion_select ON agreement_ingestions FOR SELECT
  USING (app.can_see_agreement(agreement_id));
CREATE POLICY ingestion_insert ON agreement_ingestions FOR INSERT
  WITH CHECK (app.can_review() OR app.is_own_new_agreement(agreement_id));
CREATE POLICY ingestion_update ON agreement_ingestions FOR UPDATE
  USING (app.can_review() OR app.is_own_new_agreement(agreement_id))
  WITH CHECK (app.can_review() OR app.is_own_new_agreement(agreement_id));
GRANT SELECT, INSERT, UPDATE ON agreement_ingestions TO clausepilot_app;

CREATE FUNCTION protect_ingestion_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.agreement_id IS DISTINCT FROM OLD.agreement_id OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'Ingestion identity is immutable.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'ready' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Ready source text is immutable; submit a new agreement version.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_ingestion_source BEFORE UPDATE ON agreement_ingestions
  FOR EACH ROW EXECUTE FUNCTION protect_ingestion_source();
