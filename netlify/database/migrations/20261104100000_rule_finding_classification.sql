-- KAN-60: preserve the rule engine's result semantics instead of reducing every
-- automated finding to only a category, score and source excerpt.

CREATE TYPE finding_classification AS ENUM ('present', 'deviation', 'uncertain', 'gap');

ALTER TABLE findings
  ADD COLUMN classification finding_classification;

ALTER TABLE findings
  DROP CONSTRAINT findings_manual_fields,
  DROP CONSTRAINT findings_evidence;

-- Existing rule findings predate classification. They were emitted only when
-- a provision pattern matched, so backfill them as present provisions.
UPDATE findings
   SET finding_type = 'provision',
       classification = 'present',
       severity = 'medium',
       reason = 'A provision was identified by the earlier local rule set.'
 WHERE method = 'local_rule';

ALTER TABLE findings
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
