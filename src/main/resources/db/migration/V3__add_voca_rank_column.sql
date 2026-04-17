DO $$
BEGIN
    IF to_regclass('public.voca_item') IS NULL THEN
        RETURN;
    END IF;

    ALTER TABLE voca_item ADD COLUMN IF NOT EXISTS rank SMALLINT;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'voca_item'
          AND column_name = 'favorite'
    ) THEN
        UPDATE voca_item
        SET rank = CASE WHEN favorite = TRUE THEN 1 ELSE 0 END
        WHERE rank IS NULL;
    ELSE
        UPDATE voca_item
        SET rank = 1
        WHERE rank IS NULL;
    END IF;

    ALTER TABLE voca_item ALTER COLUMN rank SET DEFAULT 1;
    ALTER TABLE voca_item ALTER COLUMN rank SET NOT NULL;

    ALTER TABLE voca_item DROP CONSTRAINT IF EXISTS chk_voca_item_rank_range;
    ALTER TABLE voca_item
        ADD CONSTRAINT chk_voca_item_rank_range CHECK (rank >= 0 AND rank <= 5);
END $$;
