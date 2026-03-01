package com.vocanote.infra.external.dictionary;

import com.vocanote.common.exception.ExternalApiException;
import com.vocanote.common.exception.NotFoundException;
import com.vocanote.service.model.DictionaryResult;
import com.vocanote.service.port.DictionaryPort;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;
import java.util.*;

@Component
public class DictionaryApiClient implements DictionaryPort {

    private final WebClient dictionaryWebClient;

    public DictionaryApiClient(@Qualifier("dictionaryWebClient") WebClient dictionaryWebClient) {
        this.dictionaryWebClient = dictionaryWebClient;
    }

    @Override
    @Cacheable(cacheNames = "dictionary", key = "#word")
    public DictionaryResult lookup(String word) {
        try {
            List<DictionaryApiEntry> entries = dictionaryWebClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/api/v2/entries/en/{word}")
                            .build(word))
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<List<DictionaryApiEntry>>() {})
                    .block(Duration.ofSeconds(3));

            if (entries == null || entries.isEmpty()) {
                throw new NotFoundException("Word not found: " + word);
            }

            DictionaryApiEntry first = entries.get(0);

            String ipa = pickIpa(first);
            String audioUrl = pickAudio(first);

            Set<String> posSet = new LinkedHashSet<>();
            List<String> defs = new ArrayList<>();
            List<String> examples = new ArrayList<>();

            if (first.meanings() != null) {
                for (DictionaryApiMeaning m : first.meanings()) {
                    if (m == null) continue;
                    if (m.partOfSpeech() != null && !m.partOfSpeech().isBlank()) {
                        posSet.add(m.partOfSpeech());
                    }
                    if (m.definitions() != null) {
                        for (DictionaryApiDefinition d : m.definitions()) {
                            if (d == null) continue;
                            if (d.definition() != null && !d.definition().isBlank()) {
                                defs.add(d.definition());
                            }
                            if (d.example() != null && !d.example().isBlank()) {
                                examples.add(d.example());
                            }
                            if (defs.size() >= 8) break;
                        }
                    }
                    if (defs.size() >= 8) break;
                }
            }

            return new DictionaryResult(
                    first.word() != null ? first.word() : word,
                    ipa,
                    audioUrl,
                    posSet.stream().toList(),
                    defs,
                    examples.stream().limit(8).toList()
            );

        } catch (WebClientResponseException.NotFound e) {
            throw new NotFoundException("Word not found: " + word);
        } catch (WebClientResponseException e) {
            throw new ExternalApiException("dictionaryapi", "HTTP " + e.getStatusCode(), e);
        } catch (Exception e) {
            throw new ExternalApiException("dictionaryapi", "Failed to call dictionaryapi.dev", e);
        }
    }

    private String pickIpa(DictionaryApiEntry entry) {
        if (entry.phonetics() == null) return null;
        return entry.phonetics().stream()
                .filter(Objects::nonNull)
                .map(DictionaryApiPhonetic::text)
                .filter(t -> t != null && !t.isBlank())
                .findFirst()
                .orElse(null);
    }

    private String pickAudio(DictionaryApiEntry entry) {
        if (entry.phonetics() == null) return null;
        return entry.phonetics().stream()
                .filter(Objects::nonNull)
                .map(DictionaryApiPhonetic::audio)
                .filter(a -> a != null && !a.isBlank())
                .findFirst()
                .orElse(null);
    }
}
