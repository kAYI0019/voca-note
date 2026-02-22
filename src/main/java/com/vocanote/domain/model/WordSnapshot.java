package com.vocanote.domain.model;

import jakarta.persistence.*;
import lombok.Getter;

import java.time.Instant;

@Entity
@Table(
        name = "word_snapshot",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_word_snapshot_lang_norm", columnNames = {"lang", "word_norm"})
        },
        indexes = {
                @Index(name = "idx_word_snapshot_lang_norm", columnList = "lang,word_norm"),
                @Index(name = "idx_word_snapshot_expires", columnList = "expires_at")
        }
)
public class WordSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name="lang", length = 10, nullable = false)
    private String lang; // 일단 "en" 고정

    @Column(name="word_raw", length = 200)
    private String wordRaw;

    // getters (필요한 것만)
    @Getter
    @Column(name="word_norm", length = 200, nullable = false)
    private String wordNorm;

    @Getter
    @Convert(converter = DictionaryPayloadJsonConverter.class)
    @Column(name="dict_payload", columnDefinition = "TEXT")
    private DictionaryPayload dictPayload;

    @Getter
    @Column(name="meaning_ko", length = 500)
    private String meaningKo;

    @Getter
    @Enumerated(EnumType.STRING)
    @Column(name="status", length = 20, nullable = false)
    private SnapshotStatus status;

    @Getter
    @Column(name="dict_source", length = 50)
    private String dictSource; // "dictionaryapi"

    @Getter
    @Column(name="translation_source", length = 50)
    private String translationSource; // "deepl-free", "disabled", "quota-exceeded", "error"

    @Column(name="fetched_at", nullable = false)
    private Instant fetchedAt;

    @Column(name="expires_at", nullable = false)
    private Instant expiresAt;

    protected WordSnapshot() { }

    public static WordSnapshot ok(
            String lang,
            String wordRaw,
            String wordNorm,
            DictionaryPayload payload,
            String meaningKo,
            String dictSource,
            String translationSource,
            Instant now,
            Instant expiresAt
    ) {
        WordSnapshot s = new WordSnapshot();
        s.lang = lang;
        s.wordRaw = wordRaw;
        s.wordNorm = wordNorm;
        s.dictPayload = payload;
        s.meaningKo = meaningKo;
        s.status = SnapshotStatus.OK;
        s.dictSource = dictSource;
        s.translationSource = translationSource;
        s.fetchedAt = now;
        s.expiresAt = expiresAt;
        return s;
    }

    public static WordSnapshot notFound(String lang, String wordRaw, String wordNorm, Instant now, Instant expiresAt) {
        WordSnapshot s = new WordSnapshot();
        s.lang = lang;
        s.wordRaw = wordRaw;
        s.wordNorm = wordNorm;
        s.status = SnapshotStatus.NOT_FOUND;
        s.dictSource = "dictionaryapi";
        s.translationSource = "disabled";
        s.fetchedAt = now;
        s.expiresAt = expiresAt;
        return s;
    }

    public static WordSnapshot error(String lang, String wordRaw, String wordNorm, Instant now, Instant expiresAt) {
        WordSnapshot s = new WordSnapshot();
        s.lang = lang;
        s.wordRaw = wordRaw;
        s.wordNorm = wordNorm;
        s.status = SnapshotStatus.ERROR;
        s.dictSource = "dictionaryapi";
        s.translationSource = "error";
        s.fetchedAt = now;
        s.expiresAt = expiresAt;
        return s;
    }

    public boolean isFresh(Instant now) {
        return expiresAt.isAfter(now);
    }

    public void updateTranslation(String meaningKo, String translationSource, Instant now, Instant expiresAt) {
        this.meaningKo = meaningKo;
        this.translationSource = translationSource;
        this.fetchedAt = now;
        this.expiresAt = expiresAt; // 번역만 갱신해도 TTL 연장할지 정책에 따라
    }
}