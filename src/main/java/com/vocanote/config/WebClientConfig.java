package com.vocanote.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
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
}
