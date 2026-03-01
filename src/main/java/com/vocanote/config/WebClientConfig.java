package com.vocanote.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class WebClientConfig {

    @Bean
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder();
    }

    @Bean
    public WebClient datamuseWebClient(WebClient.Builder builder, ExternalApiProperties props) {
        return builder
                .baseUrl(props.datamuse().baseUrl())
                .build();
    }

    @Bean
    public WebClient dictionaryWebClient(WebClient.Builder builder, ExternalApiProperties props) {
        return builder
                .baseUrl(props.dictionary().baseUrl())
                .build();
    }

    @Bean
    public WebClient deeplWebClient(WebClient.Builder builder, DeepLProperties props) {
        return builder
                .baseUrl(props.baseUrl())
                .build();
    }
}
