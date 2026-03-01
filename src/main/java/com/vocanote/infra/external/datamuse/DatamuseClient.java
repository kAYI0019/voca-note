package com.vocanote.infra.external.datamuse;

import com.vocanote.service.model.SuggestCandidate;
import com.vocanote.service.port.SuggestPort;
import com.vocanote.common.exception.ExternalApiException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;
import java.util.Collections;
import java.util.List;

@Component
public class DatamuseClient implements SuggestPort {

    private final WebClient datamuseWebClient;

    public DatamuseClient(@Qualifier("datamuseWebClient") WebClient datamuseWebClient) {
        this.datamuseWebClient = datamuseWebClient;
    }

    @Override
    @Cacheable(cacheNames = "suggest", key = "#query + ':' + #max")
    public List<SuggestCandidate> suggest(String query, int max) {
        try {
            List<DatamuseSuggestDto> resp = datamuseWebClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/sug")
                            .queryParam("s", query)
                            .queryParam("max", max)
                            .build())
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<List<DatamuseSuggestDto>>() {})
                    .block(Duration.ofSeconds(2));

            if (resp == null) return Collections.emptyList();

            return resp.stream()
                    .map(d -> new SuggestCandidate(d.word(), d.score()))
                    .toList();

        } catch (WebClientResponseException e) {
            throw new ExternalApiException("datamuse", "HTTP " + e.getStatusCode(), e);
        } catch (Exception e) {
            throw new ExternalApiException("datamuse", "Failed to call Datamuse", e);
        }
    }
}
