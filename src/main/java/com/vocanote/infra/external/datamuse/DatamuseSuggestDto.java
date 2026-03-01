package com.vocanote.infra.external.datamuse;

public record DatamuseSuggestDto(
        String word,
        Integer score
) { }
