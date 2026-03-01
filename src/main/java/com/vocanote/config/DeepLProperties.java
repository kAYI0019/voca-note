package com.vocanote.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "app.external.deepl")
public record DeepLProperties(
        String baseUrl,
        String authKey,
        Duration timeout,
        String targetLang
) { }
