package com.vocanote.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(
        Rule suggest,
        Rule entry,
        Rule voca
) {
    public record Rule(
            long capacity,
            long refillTokens,
            Duration refillPeriod
    ) { }
}
