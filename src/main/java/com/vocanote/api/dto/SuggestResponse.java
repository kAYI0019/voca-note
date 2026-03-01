package com.vocanote.api.dto;

import java.util.List;

public record SuggestResponse(
        String query,
        List<Item> items
) {
    public record Item(
            String word,
            Integer score
    ) { }
}
