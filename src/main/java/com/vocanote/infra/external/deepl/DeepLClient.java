package com.vocanote.infra.external.deepl;

import com.vocanote.common.exception.ExternalApiException;
import com.vocanote.common.exception.QuotaExceededException;
import com.vocanote.config.DeepLProperties;
import com.vocanote.service.port.TranslatorPort;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;
import java.util.Optional;

@Component
public class DeepLClient implements TranslatorPort {

    private final WebClient deeplWebClient;
    private final DeepLProperties props;

    public DeepLClient(
            @Qualifier("deeplWebClient") WebClient deeplWebClient,
            DeepLProperties props
    ) {
        this.deeplWebClient = deeplWebClient;
        this.props = props;
    }

    @Override
    @Cacheable(cacheNames = "translation_ko", key = "#text", unless = "#result == null || #result.isEmpty()")
    public Optional<String> translateToKo(String text) {
        if (props.authKey() == null || props.authKey().isBlank()) {
            // 키가 없으면 번역 기능을 비활성화한 것으로 간주
            return Optional.empty();
        }

        try {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("text", text);
            form.add("target_lang", props.targetLang() != null ? props.targetLang() : "KO");

            DeepLTranslateResponse resp = deeplWebClient.post()
                    .uri("/v2/translate")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .header("Authorization", "DeepL-Auth-Key " + props.authKey())
                    .body(BodyInserters.fromFormData(form))
                    .retrieve()
                    .bodyToMono(DeepLTranslateResponse.class)
                    .block(timeout());

            if (resp == null || resp.translations() == null || resp.translations().isEmpty()) {
                return Optional.empty();
            }

            String translated = resp.translations().get(0).text();
            return translated == null || translated.isBlank()
                    ? Optional.empty()
                    : Optional.of(translated);

        } catch (WebClientResponseException e) {
            int code = e.getStatusCode().value();

            // DeepL이 한도/과금 관련으로 429(Too Many Requests) 또는 기타 코드를 줄 수 있음.
            if (code == 429 || code == 456) {
                throw new QuotaExceededException("DeepL quota/rate limit exceeded");
            }
            throw new ExternalApiException("deepl", "HTTP " + code, e);

        } catch (QuotaExceededException qe) {
            throw qe;
        } catch (Exception e) {
            throw new ExternalApiException("deepl", "Failed to call DeepL", e);
        }
    }

    private Duration timeout() {
        return props.timeout() != null ? props.timeout() : Duration.ofSeconds(3);
    }
}
