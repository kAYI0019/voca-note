DO $$
BEGIN
    IF to_regclass('public.voca_item') IS NULL THEN
        RETURN;
    END IF;

    ALTER TABLE voca_item ADD COLUMN IF NOT EXISTS study_correct_count INTEGER;
    UPDATE voca_item SET study_correct_count = 0 WHERE study_correct_count IS NULL;
    ALTER TABLE voca_item ALTER COLUMN study_correct_count SET DEFAULT 0;
    ALTER TABLE voca_item ALTER COLUMN study_correct_count SET NOT NULL;

    ALTER TABLE voca_item ADD COLUMN IF NOT EXISTS study_partial_count INTEGER;
    UPDATE voca_item SET study_partial_count = 0 WHERE study_partial_count IS NULL;
    ALTER TABLE voca_item ALTER COLUMN study_partial_count SET DEFAULT 0;
    ALTER TABLE voca_item ALTER COLUMN study_partial_count SET NOT NULL;

    ALTER TABLE voca_item ADD COLUMN IF NOT EXISTS study_wrong_count INTEGER;
    UPDATE voca_item SET study_wrong_count = 0 WHERE study_wrong_count IS NULL;
    ALTER TABLE voca_item ALTER COLUMN study_wrong_count SET DEFAULT 0;
    ALTER TABLE voca_item ALTER COLUMN study_wrong_count SET NOT NULL;
END $$;
