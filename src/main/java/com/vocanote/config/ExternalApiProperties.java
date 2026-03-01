package com.vocanote.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.external")
public record ExternalApiProperties(
        Datamuse datamuse,
        Dictionary dictionary
) {
    public record Datamuse(String baseUrl) { }
    public record Dictionary(String baseUrl) { }
}
