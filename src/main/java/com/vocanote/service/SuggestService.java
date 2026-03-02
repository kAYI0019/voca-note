package com.vocanote.service;

import com.vocanote.api.dto.SuggestResponse;
import com.vocanote.common.exception.ExternalApiException;
import com.vocanote.service.port.SuggestPort;
import com.vocanote.common.util.WordNormalizer;
import com.vocanote.domain.model.SnapshotStatus;
import com.vocanote.domain.repository.VocaItemRepository;
import com.vocanote.domain.repository.WordSnapshotRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class SuggestService {
    private static final String LANG_EN = "en";

    private final SuggestPort suggestPort;
    private final VocaItemRepository vocaItemRepository;
    private final WordSnapshotRepository wordSnapshotRepository;

    public SuggestService(
            SuggestPort suggestPort,
            VocaItemRepository vocaItemRepository,
            WordSnapshotRepository wordSnapshotRepository
    ) {
        this.suggestPort = suggestPort;
        this.vocaItemRepository = vocaItemRepository;
        this.wordSnapshotRepository = wordSnapshotRepository;
    }

    public SuggestResponse suggest(String q, int max) {
        String query = WordNormalizer.normalizeQuery(q);
        int safeMax = Math.min(Math.max(max, 1), 20);

        if (query.isBlank()) {
            return new SuggestResponse(query, Collections.emptyList());
        }

        int localFetchSize = Math.min(60, Math.max(safeMax * 4, 20));
        Map<String, SuggestResponse.Item> mergedByNorm = new LinkedHashMap<>();

        List<String> localWords = vocaItemRepository.findWordsForSuggest(query, PageRequest.of(0, localFetchSize));
        for (int i = 0; i < localWords.size(); i += 1) {
            String word = localWords.get(i);
            addSuggestionIfAbsent(mergedByNorm, word, 1000 - i);
        }

        List<String> snapshotWords = wordSnapshotRepository.findWordNormsForSuggest(
                LANG_EN,
                SnapshotStatus.OK,
                query,
                PageRequest.of(0, localFetchSize)
        );
        for (int i = 0; i < snapshotWords.size(); i += 1) {
            String word = snapshotWords.get(i);
            addSuggestionIfAbsent(mergedByNorm, word, 800 - i);
        }

        try {
            suggestPort.suggest(query, safeMax * 2).forEach(candidate -> addSuggestionIfAbsent(mergedByNorm, candidate.word(), candidate.score()));
        } catch (ExternalApiException ignored) {
            // 외부 자동완성 실패시에도 로컬 단어/스냅샷 자동완성은 동작하도록 유지
        }

        List<SuggestResponse.Item> items = mergedByNorm.values().stream()
                .limit(safeMax)
                .toList();

        return new SuggestResponse(query, items);
    }

    private void addSuggestionIfAbsent(Map<String, SuggestResponse.Item> mergedByNorm, String rawWord, Integer score) {
        String normalizedWord = WordNormalizer.normalizeWord(rawWord);
        if (normalizedWord.isBlank() || mergedByNorm.containsKey(normalizedWord)) {
            return;
        }
        mergedByNorm.put(normalizedWord, new SuggestResponse.Item(normalizedWord, score));
    }
}
