-- KAN-21A: store the manual-flag fields from the review screen (pull request #7).
--
-- A manual flag is either a Provision, which cites exact text from the
-- agreement, or a Gap, which cites none and instead names the playbook
-- expectation the agreement fails to meet. Both carry a severity and a
-- reason. Rule findings have none of these, so the columns are empty for them.
--
-- Each finding's change history (created, edited, decision) is not a column:
-- it is read from audit_events, which records a before/after snapshot for
-- every change (see server/services/agreements.ts).

CREATE TYPE finding_type AS ENUM ('provision', 'gap');
CREATE TYPE finding_severity AS ENUM ('low', 'medium', 'high', 'critical');

ALTER TABLE findings
  ADD COLUMN finding_type         finding_type,
  ADD COLUMN severity             finding_severity,
  ADD COLUMN reason               text NOT NULL DEFAULT '',
  ADD COLUMN playbook_expectation text NOT NULL DEFAULT '';

-- Manual findings created before these fields existed cite contract text, so
-- they are provisions. Their note was the only explanation they had.
UPDATE findings
   SET finding_type = 'provision',
       severity = 'medium',
       reason = CASE WHEN btrim(note) = '' THEN 'Added manually by a reviewer.' ELSE note END
 WHERE method = 'manual';

ALTER TABLE findings
  ADD CONSTRAINT findings_manual_fields CHECK (
    CASE method
      WHEN 'local_rule' THEN finding_type IS NULL AND severity IS NULL
      ELSE finding_type IS NOT NULL AND severity IS NOT NULL AND btrim(reason) <> ''
    END
  ),
  ADD CONSTRAINT findings_evidence CHECK (
    CASE finding_type
      WHEN 'gap' THEN source_text = '' AND btrim(playbook_expectation) <> ''
      WHEN 'provision' THEN btrim(source_text) <> '' AND playbook_expectation = ''
      ELSE TRUE
    END
  );
