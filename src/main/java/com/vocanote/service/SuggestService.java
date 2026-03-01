package com.vocanote.service;

import com.vocanote.service.port.SuggestPort;
import com.vocanote.common.util.WordNormalizer;
import com.vocanote.api.dto.SuggestResponse;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

@Service
public class SuggestService {

    private final SuggestPort suggestPort;

    public SuggestService(SuggestPort suggestPort) {
        this.suggestPort = suggestPort;
    }

    public SuggestResponse suggest(String q, int max) {
        String query = WordNormalizer.normalizeQuery(q);
        int safeMax = Math.min(Math.max(max, 1), 20);

        if (query.isBlank()) {
            return new SuggestResponse(query, Collections.emptyList());
        }

        List<SuggestResponse.Item> items = suggestPort.suggest(query, safeMax).stream()
                .map(c -> new SuggestResponse.Item(c.word(), c.score()))
                .toList();

        return new SuggestResponse(query, items);
    }
}
