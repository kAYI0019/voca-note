package com.vocanote.infra.external.deepl;

import java.util.List;

public record DeepLTranslateResponse(
        List<Translation> translations
) {
    public record Translation(
            String text
    ) { }
}
