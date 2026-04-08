DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'Dispute'
  ) THEN
    UPDATE "Dispute"
    SET status = 'OPEN'
    WHERE status::text = 'RESOLVED_NOT_COMPLETED';
  END IF;
END $$;
