package com.vocanote.service.port;

import com.vocanote.service.model.DictionaryResult;

public interface DictionaryPort {
    DictionaryResult lookup(String word);
}
