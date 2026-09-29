ALTER TABLE "workflow_runs"
ALTER COLUMN "durationMs" TYPE BIGINT
USING "durationMs"::BIGINT;
