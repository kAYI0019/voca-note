package com.vocanote.service.port;

import java.util.Optional;

public interface TranslatorPort {
    Optional<String> translateToKo(String text);
}
