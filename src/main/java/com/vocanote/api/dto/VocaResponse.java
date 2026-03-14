package com.vocanote.api.dto;

import java.time.Instant;
import java.util.List;
import java.util.Set;

public record VocaResponse(
        Long id,
        String word,
        String ipa,
        String audioUrl,
        String meaningKo,
        String memo,
        Set<String> tags,
        List<String> examples,
        boolean favorite,
        int studyCorrectCount,
        int studyPartialCount,
        int studyWrongCount,
        Instant createdAt,
        Instant updatedAt
) { }
