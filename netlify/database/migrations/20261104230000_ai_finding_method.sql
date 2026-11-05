-- Netlify applies every pending migration in one transaction. Postgres
-- error 55P04 refuses to use an enum label added in that same transaction,
-- so the method is stored as text before the next migration records "ai".
--
-- Checks and the insert policy compare the old enum, so they are rebuilt
-- after the column type changes.

DROP POLICY findings_insert ON findings;
ALTER TABLE findings
  DROP CONSTRAINT findings_method_fields,
  DROP CONSTRAINT findings_evidence;

ALTER TABLE findings ALTER COLUMN method TYPE text;
DROP TYPE finding_method;

ALTER TABLE findings
  ADD CONSTRAINT findings_method_code
  CHECK (method IN ('local_rule', 'manual')),
  ADD CONSTRAINT findings_method_fields CHECK (
    CASE method
      WHEN 'local_rule' THEN
        finding_type IS NOT NULL
        AND classification IS NOT NULL
        AND severity IS NOT NULL
        AND btrim(reason) <> ''
      ELSE
        finding_type IS NOT NULL
        AND classification IS NULL
        AND severity IS NOT NULL
        AND btrim(reason) <> ''
    END
  ),
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
