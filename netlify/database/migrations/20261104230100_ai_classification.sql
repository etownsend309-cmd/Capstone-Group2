-- Store OpenAI classification beside the local-rule findings.
--
-- If an earlier attempt added the enum label and this migration is retried
-- on its own, convert that column to text before "ai" is referenced.
--
-- A requester still cannot submit findings of their own. The server classifies
-- the extracted text, keeps exact quotes, and fills categories the model did
-- not return with the local rules. Human decisions are never replaced.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'finding_method' AND n.nspname = 'public'
  ) THEN
    DROP POLICY IF EXISTS findings_insert ON findings;
    ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_method_fields;
    ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_evidence;
    ALTER TABLE findings ALTER COLUMN method TYPE text;
    DROP TYPE finding_method;
    ALTER TABLE findings
      ADD CONSTRAINT findings_evidence CHECK (
        CASE finding_type
          WHEN 'gap' THEN source_text = '' AND btrim(playbook_expectation) <> ''
          WHEN 'provision' THEN
            btrim(source_text) <> ''
            AND (method = 'local_rule' OR playbook_expectation = '')
          ELSE FALSE
        END
      );
    CREATE POLICY findings_insert ON findings FOR INSERT
      WITH CHECK (
        app.can_review()
        OR (
          app.is_own_new_agreement(agreement_id)
          AND method = 'local_rule'
          AND decision = 'pending'
        )
      );
  END IF;
END $$;

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_method_code;
ALTER TABLE findings
  ADD CONSTRAINT findings_method_code
  CHECK (method IN ('local_rule', 'manual', 'ai'));

CREATE TABLE classification_runs (
  id                    uuid PRIMARY KEY,
  agreement_id          uuid NOT NULL REFERENCES agreements (id) ON DELETE CASCADE,
  provider              text NOT NULL,
  requested_model       text NOT NULL,
  returned_model        text,
  provider_response_id  text,
  prompt_version        text NOT NULL,
  schema_version        text NOT NULL,
  model_config_version  text NOT NULL,
  started_at            timestamptz NOT NULL,
  completed_at          timestamptz NOT NULL,
  latency_ms            integer NOT NULL CHECK (latency_ms >= 0),
  input_tokens          integer,
  output_tokens         integer,
  status                text NOT NULL CHECK (status IN ('complete', 'partial', 'manual_required')),
  error_code            text,
  rejections            jsonb NOT NULL DEFAULT '[]'
);

CREATE INDEX classification_runs_agreement_id_idx ON classification_runs (agreement_id, completed_at);

ALTER TABLE agreements
  ADD COLUMN classification_status text NOT NULL DEFAULT 'manual_required'
    CHECK (classification_status IN ('complete', 'partial', 'manual_required'));

ALTER TABLE findings
  ADD COLUMN confidence_indicator   text,
  ADD COLUMN source_start           integer,
  ADD COLUMN source_end             integer,
  ADD COLUMN evidence_validation    text,
  ADD COLUMN classification_run_id  uuid REFERENCES classification_runs (id);

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_method_fields;
ALTER TABLE findings ADD CONSTRAINT findings_method_fields CHECK (
  CASE method
    WHEN 'local_rule' THEN
      finding_type IS NOT NULL
      AND classification IS NOT NULL
      AND severity IS NOT NULL
      AND btrim(reason) <> ''
      AND confidence_indicator IS NULL
      AND evidence_validation IS NULL
    WHEN 'ai' THEN
      finding_type = 'provision'
      AND classification = 'present'
      AND severity IS NULL
      AND btrim(reason) <> ''
      AND confidence_indicator IN ('low', 'medium', 'high')
      AND evidence_validation = 'exact'
      AND source_start IS NOT NULL
      AND source_end > source_start
      AND classification_run_id IS NOT NULL
    ELSE
      finding_type IS NOT NULL
      AND classification IS NULL
      AND severity IS NOT NULL
      AND btrim(reason) <> ''
      AND confidence_indicator IS NULL
      AND evidence_validation IS NULL
      AND classification_run_id IS NULL
  END
);

DROP POLICY findings_insert ON findings;
CREATE POLICY findings_insert ON findings FOR INSERT
  WITH CHECK (
    app.can_review()
    OR (
      app.is_own_new_agreement(agreement_id)
      AND method IN ('local_rule', 'ai')
      AND decision = 'pending'
    )
  );

ALTER TABLE classification_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY classification_runs_select ON classification_runs FOR SELECT
  USING (app.can_see_agreement(agreement_id));
CREATE POLICY classification_runs_insert ON classification_runs FOR INSERT
  WITH CHECK (app.can_review() OR app.is_own_new_agreement(agreement_id));

GRANT SELECT, INSERT ON classification_runs TO clausepilot_app;
