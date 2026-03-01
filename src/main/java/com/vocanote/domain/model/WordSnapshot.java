package com.vocanote.domain.model;

import jakarta.persistence.*;
import lombok.Getter;

import java.time.Instant;

@Entity
@Table(
        name = "word_snapshot",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_word_snapshot_lang_norm",
                        columnNames = {"lang", "word_norm"}
                )
        },
        indexes = {
                @Index(name = "idx_word_snapshot_lang_norm", columnList = "lang,word_norm"),
                @Index(name = "idx_word_snapshot_expires", columnList = "expires_at")
        }
)
@Getter
public class WordSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "lang", length = 10, nullable = false)
    private String lang;

    @Column(name = "word_raw", length = 200)
    private String wordRaw;

    @Column(name = "word_norm", length = 200, nullable = false)
    private String wordNorm;

    @Convert(converter = DictionaryPayloadJsonConverter.class)
    @Column(name = "dict_payload", columnDefinition = "TEXT")
    private DictionaryPayload dictPayload;

    @Column(name = "meaning_ko", length = 500)
    private String meaningKo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20, nullable = false)
    private SnapshotStatus status;

    @Column(name = "dict_source", length = 50)
    private String dictSource;

    @Column(name = "translation_source", length = 50)
    private String translationSource;

    @Column(name = "fetched_at", nullable = false)
    private Instant fetchedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    protected WordSnapshot() {
    }

    public static WordSnapshot ok(
            String lang,
            String wordRaw,
            String wordNorm,
            DictionaryPayload dictPayload,
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
        s.dictPayload = dictPayload;
        s.meaningKo = meaningKo;
        s.status = SnapshotStatus.OK;
        s.dictSource = dictSource;
        s.translationSource = translationSource;
        s.fetchedAt = now;
        s.expiresAt = expiresAt;
        return s;
    }

    public static WordSnapshot notFound(String lang, String wordRaw, String wordNorm, String dictSource, Instant now, Instant expiresAt) {
        WordSnapshot s = new WordSnapshot();
        s.lang = lang;
        s.wordRaw = wordRaw;
        s.wordNorm = wordNorm;
        s.status = SnapshotStatus.NOT_FOUND;
        s.dictSource = dictSource;
        s.translationSource = "disabled";
        s.fetchedAt = now;
        s.expiresAt = expiresAt;
        return s;
    }

    public static WordSnapshot error(String lang, String wordRaw, String wordNorm, String dictSource, Instant now, Instant expiresAt) {
        WordSnapshot s = new WordSnapshot();
        s.lang = lang;
        s.wordRaw = wordRaw;
        s.wordNorm = wordNorm;
        s.status = SnapshotStatus.ERROR;
        s.dictSource = dictSource;
        s.translationSource = "error";
        s.fetchedAt = now;
        s.expiresAt = expiresAt;
        return s;
    }

    public boolean isFresh(Instant now) {
        return expiresAt.isAfter(now);
    }

    public void updateOk(DictionaryPayload payload, String meaningKo, String translationSource, Instant now, Instant expiresAt) {
        this.dictPayload = payload;
        this.meaningKo = meaningKo;
        this.status = SnapshotStatus.OK;
        this.translationSource = translationSource;
        this.fetchedAt = now;
        this.expiresAt = expiresAt;
    }

    public void updateTranslationOnly(String meaningKo, String translationSource, Instant now, Instant expiresAt) {
        this.meaningKo = meaningKo;
        this.translationSource = translationSource;
        this.fetchedAt = now;
        this.expiresAt = expiresAt;
    }
}
