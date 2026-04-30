CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS "ServerMetricCounter" (
  name TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "ServerMetricCounter"
  ALTER COLUMN value TYPE BIGINT;

DO $$
DECLARE
  trgm_ops TEXT;
BEGIN
  SELECT format('%I.gin_trgm_ops', n.nspname)
  INTO trgm_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gin_trgm_ops'
    AND am.amname = 'gin'
  ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname
  LIMIT 1;

  IF trgm_ops IS NULL THEN
    RAISE EXCEPTION 'pg_trgm gin_trgm_ops operator class is unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'Task'
  ) THEN
    ALTER TABLE "Task"
      ADD COLUMN IF NOT EXISTS "intentCount" INTEGER NOT NULL DEFAULT 0;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'TaskIntention'
    ) THEN
      UPDATE "Task" AS t
      SET "intentCount" = COALESCE(counts.intent_count, 0)
      FROM (
        SELECT t2.id, COUNT(ti.id)::integer AS intent_count
        FROM "Task" AS t2
        LEFT JOIN "TaskIntention" AS ti ON ti."taskId" = t2.id
        GROUP BY t2.id
      ) AS counts
      WHERE t.id = counts.id
        AND t."intentCount" IS DISTINCT FROM counts.intent_count;
    ELSE
      UPDATE "Task"
      SET "intentCount" = 0
      WHERE "intentCount" IS DISTINCT FROM 0;
    END IF;

    UPDATE "Task"
    SET "intentCount" = 0
    WHERE "intentCount" IS NULL;

    EXECUTE 'CREATE INDEX IF NOT EXISTS "Task_publisherAddress_lower_idx" ON "Task" (lower("publisherAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Task_publisherAddress_lower_updatedAt_id_idx" ON "Task" (lower("publisherAddress"), "updatedAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Task_publisherAddress_lower_createdAt_id_idx" ON "Task" (lower("publisherAddress"), "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Task_publisherAddress_lower_deadlineUtc_id_idx" ON "Task" (lower("publisherAddress"), "deadlineUtc", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Task_publisherAddress_lower_rewardPerSlot_id_idx" ON "Task" (lower("publisherAddress"), "rewardPerSlot", id)';
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Task_id_trgm_idx" ON "Task" USING gin (id %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Task_title_trgm_idx" ON "Task" USING gin (title %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Task_descriptionMd_trgm_idx" ON "Task" USING gin ("descriptionMd" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Task_acceptanceCriteria_trgm_idx" ON "Task" USING gin ("acceptanceCriteria" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Task_publisherAddress_trgm_idx" ON "Task" USING gin ("publisherAddress" %s)', trgm_ops);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'Submission'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Submission_agentAddress_lower_idx" ON "Submission" (lower("agentAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Submission_agentAddress_lower_updatedAt_id_idx" ON "Submission" (lower("agentAddress"), "updatedAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Submission_agentAddress_lower_createdAt_id_idx" ON "Submission" (lower("agentAddress"), "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Submission_agentAddress_lower_taskId_createdAt_id_idx" ON "Submission" (lower("agentAddress"), "taskId", "createdAt" DESC, id DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Submission_taskId_agentAddress_lower_idx" ON "Submission" ("taskId", lower("agentAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Submission_taskId_submitted_idx" ON "Submission" ("taskId") WHERE status = ''SUBMITTED''::"SubmissionStatus"';
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Submission_id_trgm_idx" ON "Submission" USING gin (id %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Submission_taskId_trgm_idx" ON "Submission" USING gin ("taskId" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Submission_agentAddress_trgm_idx" ON "Submission" USING gin ("agentAddress" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Submission_payloadMd_trgm_idx" ON "Submission" USING gin ("payloadMd" %s)', trgm_ops);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'TaskIntention'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "TaskIntention_agentAddress_lower_idx" ON "TaskIntention" (lower("agentAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "TaskIntention_agentAddress_lower_taskId_idx" ON "TaskIntention" (lower("agentAddress"), "taskId")';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "TaskIntention_taskId_agentAddress_lower_idx" ON "TaskIntention" ("taskId", lower("agentAddress"))';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'Dispute'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'Task'
    ) AND EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'Submission'
    ) THEN
      UPDATE "Dispute" AS d
      SET "counterpartyResponderAddress" = CASE
          WHEN lower(d."openerAddress") = lower(t."publisherAddress") THEN s."agentAddress"
          WHEN lower(d."openerAddress") = lower(s."agentAddress") THEN t."publisherAddress"
          ELSE d."counterpartyResponderAddress"
        END
      FROM "Task" AS t, "Submission" AS s
      WHERE d."taskId" = t.id
        AND d."submissionId" = s.id
        AND d."counterpartyResponderAddress" IS NULL
        AND btrim(COALESCE(d."counterpartyReasonMd", '')) <> ''
        AND (
          lower(d."openerAddress") = lower(t."publisherAddress")
          OR lower(d."openerAddress") = lower(s."agentAddress")
        );
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_openerAddress_lower_idx" ON "Dispute" (lower("openerAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_openerAddress_lower_updatedAt_id_idx" ON "Dispute" (lower("openerAddress"), "updatedAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_openerAddress_lower_createdAt_id_idx" ON "Dispute" (lower("openerAddress"), "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_counterpartyResponderAddress_lower_idx" ON "Dispute" (lower("counterpartyResponderAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_counterpartyResponderAddress_lower_updatedAt_id_idx" ON "Dispute" (lower("counterpartyResponderAddress"), "updatedAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_taskId_open_idx" ON "Dispute" ("taskId") WHERE status = ''OPEN''::"DisputeStatus"';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_submissionId_open_idx" ON "Dispute" ("submissionId") WHERE status = ''OPEN''::"DisputeStatus"';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Dispute_updatedAt_id_idx" ON "Dispute" ("updatedAt", id)';
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Dispute_id_trgm_idx" ON "Dispute" USING gin (id %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Dispute_taskId_trgm_idx" ON "Dispute" USING gin ("taskId" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Dispute_submissionId_trgm_idx" ON "Dispute" USING gin ("submissionId" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Dispute_openerAddress_trgm_idx" ON "Dispute" USING gin ("openerAddress" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Dispute_reasonMd_trgm_idx" ON "Dispute" USING gin ("reasonMd" %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "Dispute_counterpartyReasonMd_trgm_idx" ON "Dispute" USING gin ("counterpartyReasonMd" %s)', trgm_ops);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'ActivityEvent'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivityEvent_actorAddress_lower_idx" ON "ActivityEvent" (lower("actorAddress"))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivityEvent_actorAddress_lower_createdAt_id_idx" ON "ActivityEvent" (lower("actorAddress"), "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivityEvent_type_createdAt_id_idx" ON "ActivityEvent" (type, "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivityEvent_cycleId_createdAt_id_idx" ON "ActivityEvent" ("cycleId", "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivityEvent_taskId_createdAt_id_idx" ON "ActivityEvent" ("taskId", "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivityEvent_disputeId_createdAt_id_idx" ON "ActivityEvent" ("disputeId", "createdAt", id)';
    EXECUTE format('CREATE INDEX IF NOT EXISTS "ActivityEvent_actorAddress_trgm_idx" ON "ActivityEvent" USING gin ("actorAddress" %s)', trgm_ops);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'ServerRequestLog'
  ) THEN
    UPDATE "ServerRequestLog"
    SET method = upper(btrim(method))
    WHERE method IS DISTINCT FROM upper(btrim(method));

    EXECUTE 'CREATE INDEX IF NOT EXISTS "ServerRequestLog_actorAddress_lower_createdAt_id_idx" ON "ServerRequestLog" (lower("actorAddress"), "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ServerRequestLog_routeId_method_createdAt_id_idx" ON "ServerRequestLog" ("routeId", method, "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ServerRequestLog_routeId_method_statusCode_createdAt_id_idx" ON "ServerRequestLog" ("routeId", method, "statusCode", "createdAt", id)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'ServerAuditLog'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ServerAuditLog_actorAddress_lower_createdAt_id_idx" ON "ServerAuditLog" (lower("actorAddress"), "createdAt", id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ServerAuditLog_category_action_outcome_createdAt_id_idx" ON "ServerAuditLog" (category, action, outcome, "createdAt", id)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'AgentProfile'
  ) THEN
    ALTER TABLE "AgentProfile"
      ADD COLUMN IF NOT EXISTS "latestActivityAt" TIMESTAMP(3);

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'ActivityEvent'
    ) THEN
      UPDATE "AgentProfile" AS ap
      SET "latestActivityAt" = latest.latest_activity_at
      FROM (
        SELECT ap2.address, MAX(ae."createdAt") AS latest_activity_at
        FROM "AgentProfile" AS ap2
        LEFT JOIN "ActivityEvent" AS ae ON ae."actorAddress" = ap2.address
        GROUP BY ap2.address
      ) AS latest
      WHERE ap.address = latest.address
        AND ap."latestActivityAt" IS DISTINCT FROM latest.latest_activity_at;
    ELSE
      UPDATE "AgentProfile"
      SET "latestActivityAt" = NULL
      WHERE "latestActivityAt" IS NOT NULL;
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS "AgentProfile_latestActivityAt_address_idx" ON "AgentProfile" ("latestActivityAt", address)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "AgentProfile_latestActivityAt_nulls_first_address_idx" ON "AgentProfile" ("latestActivityAt" ASC NULLS FIRST, address ASC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "AgentProfile_reputationSum_address_idx" ON "AgentProfile" (("publisherRep" + "workerRep" + "supervisorRep"), address)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "AgentProfile_tasksCompletedCount_address_idx" ON "AgentProfile" ("tasksCompletedCount", address)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "AgentProfile_tasksPublishedCount_address_idx" ON "AgentProfile" ("tasksPublishedCount", address)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "AgentProfile_tasksIntentedCount_address_idx" ON "AgentProfile" ("tasksIntentedCount", address)';
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AgentProfile_address_trgm_idx" ON "AgentProfile" USING gin (address %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AgentProfile_name_trgm_idx" ON "AgentProfile" USING gin (name %s)', trgm_ops);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AgentProfile_bio_trgm_idx" ON "AgentProfile" USING gin (bio %s)', trgm_ops);
  END IF;
END $$;
