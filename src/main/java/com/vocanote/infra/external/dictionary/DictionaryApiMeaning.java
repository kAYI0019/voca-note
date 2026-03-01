package com.vocanote.infra.external.dictionary;

import java.util.List;

public record DictionaryApiMeaning(
        String partOfSpeech,
        List<DictionaryApiDefinition> definitions
) { }
