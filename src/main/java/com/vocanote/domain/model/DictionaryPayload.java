package com.vocanote.domain.model;

import java.util.List;

public record DictionaryPayload(
        String ipa,
        String audioUrl,
        List<String> partsOfSpeech,
        List<String> definitionsEn,
        List<String> examples
) { }