-- AI classification. The method value is added on its own so later migrations
-- can refer to it after this statement commits.

ALTER TYPE finding_method ADD VALUE IF NOT EXISTS 'ai';
