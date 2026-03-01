package com.vocanote.service;


import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;

import com.vocanote.api.dto.EntryResponse;
import com.vocanote.common.exception.ExternalApiException;
import com.vocanote.common.exception.NotFoundException;
import com.vocanote.common.exception.QuotaExceededException;
import com.vocanote.common.util.WordNormalizer;
import com.vocanote.domain.model.DictionaryPayload;
import com.vocanote.domain.model.SnapshotStatus;
import com.vocanote.domain.model.WordSnapshot;
import com.vocanote.domain.repository.WordSnapshotRepository;
import com.vocanote.service.model.DictionaryResult;
import com.vocanote.service.port.DictionaryPort;
import com.vocanote.service.port.TranslatorPort;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LookupService {

    private static final String LANG_EN = "en";
    private static final String DICT_SOURCE = "dictionaryapi";

    // TTL policies
    private static final int TTL_OK_DAYS = 30;
    private static final int TTL_NOT_FOUND_DAYS = 1;
    private static final int TTL_ERROR_MINUTES = 10;

    // payload trimming (defensive)
    private static final int MAX_POS = 8;
    private static final int MAX_DEFS = 10;
    private static final int MAX_EXAMPLES = 10;
    private static final int MAX_POS_LEN = 50;
    private static final int MAX_DEF_LEN = 2000;
    private static final int MAX_EXAMPLE_LEN = 2000;

    private final DictionaryPort dictionaryPort;
    private final TranslatorPort translatorPort;
    private final WordSnapshotRepository snapshotRepository;
    private final CacheManager cacheManager;

    public LookupService(
            DictionaryPort dictionaryPort,
            TranslatorPort translatorPort,
            WordSnapshotRepository snapshotRepository,
            CacheManager cacheManager
    ) {
        this.dictionaryPort = dictionaryPort;
        this.translatorPort = translatorPort;
        this.snapshotRepository = snapshotRepository;
        this.cacheManager = cacheManager;
    }

    @Transactional
    public EntryResponse lookup(String rawWord) {
        String wordNorm = WordNormalizer.normalizeWord(rawWord);
        Instant now = Instant.now();

        // 1) miss cache (없는 단어 반복 호출 방지)
        Cache missCache = cacheManager.getCache("entryMiss");
        if (missCache != null && missCache.get(wordNorm) != null) {
            throw new NotFoundException("Word not found: " + wordNorm);
        }

        // 2) DB snapshot (있으면 외부 사전 API는 아예 안 탐)
        Optional<WordSnapshot> cached = snapshotRepository.findByLangAndWordNorm(LANG_EN, wordNorm);
        if (cached.isPresent()) {
            WordSnapshot s = cached.get();

            // negative cache
            if (s.getStatus() == SnapshotStatus.NOT_FOUND && s.isFresh(now)) {
                if (missCache != null) missCache.put(wordNorm, true);
                throw new NotFoundException("Word not found: " + wordNorm);
            }

            // transient error cache
            if (s.getStatus() == SnapshotStatus.ERROR && s.isFresh(now)) {
                throw new ExternalApiException(DICT_SOURCE, "Upstream error (cached)");
            }

            // fresh OK snapshot
            if (s.getStatus() == SnapshotStatus.OK && s.isFresh(now)) {
                WordSnapshot updated = maybeTranslateOnly(s, wordNorm, now);
                return toResponseFromSnapshot(updated);
            }

            // expired snapshot: refresh now
            return refreshAndRespond(rawWord, wordNorm, missCache, now, s);
        }

        // cache miss: fetch and save
        return refreshAndRespond(rawWord, wordNorm, missCache, now, null);
    }

    private WordSnapshot maybeTranslateOnly(WordSnapshot s, String wordNorm, Instant now) {
        if (s.getMeaningKo() != null) return s;

        String translationSource = "disabled";
        try {
            String meaningKo = translatorPort.translateToKo(wordNorm).orElse(null);
            if (meaningKo != null) {
                translationSource = "deepl-free";
                s.updateTranslationOnly(
                        meaningKo,
                        translationSource,
                        now,
                        now.plus(TTL_OK_DAYS, ChronoUnit.DAYS)
                );
                return safeSaveSnapshot(s);
            }
        } catch (QuotaExceededException qe) {
            translationSource = "quota-exceeded";
        } catch (ExternalApiException ex) {
            translationSource = "error";
        } catch (Exception ex) {
            translationSource = "error";
        }

        return s;
    }

    private EntryResponse refreshAndRespond(
            String rawWord,
            String wordNorm,
            Cache missCache,
            Instant now,
            WordSnapshot existing
    ) {
        DictionaryResult dict;
        try {
            dict = dictionaryPort.lookup(wordNorm);
        } catch (NotFoundException nf) {
            if (missCache != null) missCache.put(wordNorm, true);
            WordSnapshot nfSnap = WordSnapshot.notFound(
                    LANG_EN,
                    rawWord,
                    wordNorm,
                    DICT_SOURCE,
                    now,
                    now.plus(TTL_NOT_FOUND_DAYS, ChronoUnit.DAYS)
            );
            safeSaveSnapshot(nfSnap);
            throw nf;
        } catch (ExternalApiException ex) {
            WordSnapshot errSnap = WordSnapshot.error(
                    LANG_EN,
                    rawWord,
                    wordNorm,
                    DICT_SOURCE,
                    now,
                    now.plus(TTL_ERROR_MINUTES, ChronoUnit.MINUTES)
            );
            safeSaveSnapshot(errSnap);
            throw ex;
        }

        DictionaryPayload payload = sanitizePayload(
                dict.ipa(),
                dict.audioUrl(),
                dict.partsOfSpeech(),
                dict.definitionsEn(),
                dict.examples()
        );

        String meaningKo = null;
        String translationSource = "disabled";
        try {
            meaningKo = translatorPort.translateToKo(wordNorm).orElse(null);
            translationSource = meaningKo != null ? "deepl-free" : "disabled";
        } catch (QuotaExceededException qe) {
            translationSource = "quota-exceeded";
        } catch (ExternalApiException ex) {
            translationSource = "error";
        } catch (Exception ex) {
            translationSource = "error";
        }

        WordSnapshot saved;
        if (existing != null) {
            existing.updateOk(payload, meaningKo, translationSource, now, now.plus(TTL_OK_DAYS, ChronoUnit.DAYS));
            saved = safeSaveSnapshot(existing);
        } else {
            WordSnapshot fresh = WordSnapshot.ok(
                    LANG_EN,
                    rawWord,
                    wordNorm,
                    payload,
                    meaningKo,
                    DICT_SOURCE,
                    translationSource,
                    now,
                    now.plus(TTL_OK_DAYS, ChronoUnit.DAYS)
            );
            saved = safeSaveSnapshot(fresh);
        }

        // miss cache cleanup: allow future lookups if it was previously marked
        if (missCache != null) missCache.evict(wordNorm);

        return toResponseFromSnapshot(saved);
    }

    private WordSnapshot safeSaveSnapshot(WordSnapshot snapshot) {
        try {
            return snapshotRepository.save(snapshot);
        } catch (DataIntegrityViolationException dup) {
            // concurrent insert race on unique (lang, wordNorm)
            return snapshotRepository.findByLangAndWordNorm(snapshot.getLang(), snapshot.getWordNorm())
                    .orElseThrow(() -> dup);
        }
    }

    private DictionaryPayload sanitizePayload(
            String ipa,
            String audioUrl,
            List<String> pos,
            List<String> defs,
            List<String> examples
    ) {
        List<String> pos2 = trimList(pos, MAX_POS, MAX_POS_LEN);
        List<String> defs2 = trimList(defs, MAX_DEFS, MAX_DEF_LEN);
        List<String> ex2 = dedupeAndTrimList(examples, MAX_EXAMPLES, MAX_EXAMPLE_LEN);
        return new DictionaryPayload(ipa, audioUrl, pos2, defs2, ex2);
    }

    private List<String> trimList(List<String> in, int maxItems, int maxLen) {
        if (in == null || in.isEmpty()) return List.of();
        List<String> out = new ArrayList<>();
        for (String s : in) {
            if (s == null) continue;
            String t = s.trim();
            if (t.isBlank()) continue;
            if (t.length() > maxLen) t = t.substring(0, maxLen);
            out.add(t);
            if (out.size() >= maxItems) break;
        }
        return out;
    }

    private List<String> dedupeAndTrimList(List<String> in, int maxItems, int maxLen) {
        if (in == null || in.isEmpty()) return List.of();
        LinkedHashSet<String> set = new LinkedHashSet<>();
        for (String s : in) {
            if (s == null) continue;
            String t = s.trim();
            if (t.isBlank()) continue;
            if (t.length() > maxLen) t = t.substring(0, maxLen);
            set.add(t);
            if (set.size() >= maxItems) break;
        }
        return set.stream().toList();
    }

    private EntryResponse toResponseFromSnapshot(WordSnapshot s) {
        DictionaryPayload p = s.getDictPayload();
        return new EntryResponse(
                s.getWordNorm(),
                new EntryResponse.Phonetics(p != null ? p.ipa() : null, p != null ? p.audioUrl() : null),
                p != null ? p.partsOfSpeech() : List.of(),
                p != null ? p.definitionsEn() : List.of(),
                p != null ? p.examples() : List.of(),
                s.getMeaningKo(),
                new EntryResponse.Source(s.getDictSource(), s.getTranslationSource())
        );
    }
}
