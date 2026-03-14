DO $$
BEGIN
    IF to_regclass('public.voca_item') IS NULL THEN
        RETURN;
    END IF;

    ALTER TABLE voca_item ADD COLUMN IF NOT EXISTS favorite BOOLEAN;
    UPDATE voca_item SET favorite = FALSE WHERE favorite IS NULL;
    ALTER TABLE voca_item ALTER COLUMN favorite SET DEFAULT FALSE;
    ALTER TABLE voca_item ALTER COLUMN favorite SET NOT NULL;
END $$;
