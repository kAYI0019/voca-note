package com.vocanote.api.dto;

import java.time.Instant;
import java.util.List;
import java.util.Set;

public record VocaResponse(
        Long id,
        String word,
        String meaningKo,
        String memo,
        Set<String> tags,
        List<String> examples,
        Instant createdAt,
        Instant updatedAt
) { }
