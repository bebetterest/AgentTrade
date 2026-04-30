DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'Dispute'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "Dispute"
      WHERE "status" = 'OPEN'::"DisputeStatus"
      GROUP BY "submissionId"
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION
        'cannot enforce uq_dispute_open_submission: duplicate OPEN disputes exist for at least one submission';
    END IF;

    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_dispute_open_submission"
        ON "Dispute" ("submissionId")
        WHERE "status" = ''OPEN''::"DisputeStatus"
    ';
  END IF;
END $$;
