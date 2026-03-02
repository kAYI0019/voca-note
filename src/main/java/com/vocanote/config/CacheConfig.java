package com.vocanote.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.cache.Cache;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;

import java.time.Duration;

@Configuration
public class CacheConfig implements CachingConfigurer {
    private static final Logger log = LoggerFactory.getLogger(CacheConfig.class);

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

    @Override
    public CacheErrorHandler errorHandler() {
        return new CacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException exception, Cache cache, Object key) {
                log.warn(
                        "Cache GET error ignored. cache={}, key={}, reason={}: {}",
                        cacheName(cache),
                        key,
                        exception.getClass().getSimpleName(),
                        exception.getMessage()
                );
            }

            @Override
            public void handleCachePutError(RuntimeException exception, Cache cache, Object key, Object value) {
                log.warn(
                        "Cache PUT error ignored. cache={}, key={}, reason={}: {}",
                        cacheName(cache),
                        key,
                        exception.getClass().getSimpleName(),
                        exception.getMessage()
                );
            }

            @Override
            public void handleCacheEvictError(RuntimeException exception, Cache cache, Object key) {
                log.warn(
                        "Cache EVICT error ignored. cache={}, key={}, reason={}: {}",
                        cacheName(cache),
                        key,
                        exception.getClass().getSimpleName(),
                        exception.getMessage()
                );
            }

            @Override
            public void handleCacheClearError(RuntimeException exception, Cache cache) {
                log.warn(
                        "Cache CLEAR error ignored. cache={}, reason={}: {}",
                        cacheName(cache),
                        exception.getClass().getSimpleName(),
                        exception.getMessage()
                );
            }

            private String cacheName(Cache cache) {
                if (cache == null || cache.getName() == null) {
                    return "unknown";
                }
                return cache.getName();
            }
        };
    }
}
