package com.vocanote.config;

import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;

import java.time.Duration;

@Configuration
public class CacheConfig {

    @Bean
    public RedisCacheManagerBuilderCustomizer redisCacheManagerBuilderCustomizer() {
        RedisCacheConfiguration base = RedisCacheConfiguration.defaultCacheConfig()
                .serializeValuesWith(
                        RedisSerializationContext.SerializationPair.fromSerializer(RedisSerializer.json())
                )
                .disableCachingNullValues();

        return builder -> builder
                .cacheDefaults(base)
                .withCacheConfiguration("suggest", base.entryTtl(Duration.ofHours(6)))
                .withCacheConfiguration("dictionary", base.entryTtl(Duration.ofDays(30)))
                .withCacheConfiguration("translation_ko", base.entryTtl(Duration.ofDays(90)))
                .withCacheConfiguration("entryMiss", base.entryTtl(Duration.ofDays(1)));
    }
}
