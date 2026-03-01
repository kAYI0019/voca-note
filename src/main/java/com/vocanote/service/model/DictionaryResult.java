package com.vocanote.service.model;

import java.util.List;

public record DictionaryResult(
        String word,
        String ipa,
        String audioUrl,
        List<String> partsOfSpeech,
        List<String> definitionsEn,
        List<String> examples
) { }
