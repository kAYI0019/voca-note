package com.vocanote.infra.external.dictionary;

import java.util.List;

public record DictionaryApiEntry(
        String word,
        List<DictionaryApiPhonetic> phonetics,
        List<DictionaryApiMeaning> meanings
) { }
