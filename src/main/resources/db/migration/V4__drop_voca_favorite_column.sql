DO $$
BEGIN
    IF to_regclass('public.voca_item') IS NULL THEN
        RETURN;
    END IF;

    ALTER TABLE voca_item DROP COLUMN IF EXISTS favorite;
END $$;
