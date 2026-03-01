package com.vocanote.api.dto;

import java.util.List;

public record EntryResponse(
        String word,
        Phonetics phonetics,
        List<String> pos,
        List<String> definitionsEn,
        List<String> examples,
        String meaningKo,
        Source source
) {
    public record Phonetics(
            String ipa,
            String audioUrl
    ) { }

    public record Source(
            String dictionary,
            String translation
    ) { }
}
