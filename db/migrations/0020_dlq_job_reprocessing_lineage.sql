-- Moventra TMS — Migration 0020: Governed Job reprocessing lineage
-- Phase 026 — DLQ / governed Job reprocessing
--
-- Adds explicit relational lineage from a reprocessed Job to both the terminal source Job
-- and the DLQ decision that authorized the replay. One DLQ entry may create at most one
-- logical child Job, which is the database-level idempotency guard for ambiguous retries.

ALTER TABLE jobs.jobs
  ADD COLUMN IF NOT EXISTS reprocessed_from_job_id UUID NULL,
  ADD COLUMN IF NOT EXISTS reprocessed_from_dlq_entry_id UUID NULL;

ALTER TABLE jobs.system_jobs
  ADD COLUMN IF NOT EXISTS reprocessed_from_job_id UUID NULL,
  ADD COLUMN IF NOT EXISTS reprocessed_from_dlq_entry_id UUID NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_jobs_jobs_reprocessed_from_job'
       AND conrelid = 'jobs.jobs'::regclass
  ) THEN
    ALTER TABLE jobs.jobs
      ADD CONSTRAINT fk_jobs_jobs_reprocessed_from_job
      FOREIGN KEY (reprocessed_from_job_id)
      REFERENCES jobs.jobs(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_jobs_jobs_reprocessed_from_dlq'
       AND conrelid = 'jobs.jobs'::regclass
  ) THEN
    ALTER TABLE jobs.jobs
      ADD CONSTRAINT fk_jobs_jobs_reprocessed_from_dlq
      FOREIGN KEY (reprocessed_from_dlq_entry_id)
      REFERENCES dlq.entries(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_jobs_jobs_reprocess_lineage_pair'
       AND conrelid = 'jobs.jobs'::regclass
  ) THEN
    ALTER TABLE jobs.jobs
      ADD CONSTRAINT ck_jobs_jobs_reprocess_lineage_pair
      CHECK (
        (reprocessed_from_job_id IS NULL AND reprocessed_from_dlq_entry_id IS NULL)
        OR
        (reprocessed_from_job_id IS NOT NULL AND reprocessed_from_dlq_entry_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_jobs_jobs_reprocess_not_self'
       AND conrelid = 'jobs.jobs'::regclass
  ) THEN
    ALTER TABLE jobs.jobs
      ADD CONSTRAINT ck_jobs_jobs_reprocess_not_self
      CHECK (reprocessed_from_job_id IS NULL OR reprocessed_from_job_id <> id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_jobs_system_jobs_reprocessed_from_job'
       AND conrelid = 'jobs.system_jobs'::regclass
  ) THEN
    ALTER TABLE jobs.system_jobs
      ADD CONSTRAINT fk_jobs_system_jobs_reprocessed_from_job
      FOREIGN KEY (reprocessed_from_job_id)
      REFERENCES jobs.system_jobs(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_jobs_system_jobs_reprocessed_from_dlq'
       AND conrelid = 'jobs.system_jobs'::regclass
  ) THEN
    ALTER TABLE jobs.system_jobs
      ADD CONSTRAINT fk_jobs_system_jobs_reprocessed_from_dlq
      FOREIGN KEY (reprocessed_from_dlq_entry_id)
      REFERENCES dlq.system_entries(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_jobs_system_jobs_reprocess_lineage_pair'
       AND conrelid = 'jobs.system_jobs'::regclass
  ) THEN
    ALTER TABLE jobs.system_jobs
      ADD CONSTRAINT ck_jobs_system_jobs_reprocess_lineage_pair
      CHECK (
        (reprocessed_from_job_id IS NULL AND reprocessed_from_dlq_entry_id IS NULL)
        OR
        (reprocessed_from_job_id IS NOT NULL AND reprocessed_from_dlq_entry_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_jobs_system_jobs_reprocess_not_self'
       AND conrelid = 'jobs.system_jobs'::regclass
  ) THEN
    ALTER TABLE jobs.system_jobs
      ADD CONSTRAINT ck_jobs_system_jobs_reprocess_not_self
      CHECK (reprocessed_from_job_id IS NULL OR reprocessed_from_job_id <> id);
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_jobs_reprocessed_from_dlq
  ON jobs.jobs (reprocessed_from_dlq_entry_id)
  WHERE reprocessed_from_dlq_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_jobs_jobs_reprocessed_from_job
  ON jobs.jobs (tenant_id, reprocessed_from_job_id, created_at)
  WHERE reprocessed_from_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_system_jobs_reprocessed_from_dlq
  ON jobs.system_jobs (reprocessed_from_dlq_entry_id)
  WHERE reprocessed_from_dlq_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_jobs_system_jobs_reprocessed_from_job
  ON jobs.system_jobs (reprocessed_from_job_id, created_at)
  WHERE reprocessed_from_job_id IS NOT NULL;

COMMENT ON COLUMN jobs.jobs.reprocessed_from_job_id IS
  'Terminal tenant Job that was authoritatively rescheduled by a governed DLQ decision.';
COMMENT ON COLUMN jobs.jobs.reprocessed_from_dlq_entry_id IS
  'Tenant DLQ entry that authorized this logical replay; unique to make replay idempotent.';
COMMENT ON COLUMN jobs.system_jobs.reprocessed_from_job_id IS
  'Terminal system Job that was authoritatively rescheduled by a governed DLQ decision.';
COMMENT ON COLUMN jobs.system_jobs.reprocessed_from_dlq_entry_id IS
  'System DLQ entry that authorized this logical replay; unique to make replay idempotent.';
