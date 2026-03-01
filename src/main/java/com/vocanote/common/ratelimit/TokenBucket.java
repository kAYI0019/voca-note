package com.vocanote.common.ratelimit;

import java.time.Duration;

/**
 * 의존성 없이 쓰는 간단 Token Bucket.
 * - capacity: 최대 토큰
 * - refillTokens: refillPeriod마다 추가되는 토큰 수
 * - refillPeriod: 리필 주기
 */
public class TokenBucket {

    private final long capacity;
    private final long refillTokens;
    private final long refillPeriodNanos;

    private long availableTokens;
    private long lastRefillTimeNanos;

    public TokenBucket(long capacity, long refillTokens, Duration refillPeriod) {
        if (capacity <= 0 || refillTokens <= 0) {
            throw new IllegalArgumentException("capacity/refillTokens must be > 0");
        }
        this.capacity = capacity;
        this.refillTokens = refillTokens;
        this.refillPeriodNanos = refillPeriod.toNanos();

        this.availableTokens = capacity;
        this.lastRefillTimeNanos = System.nanoTime();
    }

    public synchronized boolean tryConsume() {
        refillIfNeeded();
        if (availableTokens > 0) {
            availableTokens--;
            return true;
        }
        return false;
    }

    private void refillIfNeeded() {
        long now = System.nanoTime();
        long elapsed = now - lastRefillTimeNanos;
        if (elapsed <= 0) return;

        long periods = elapsed / refillPeriodNanos;
        if (periods <= 0) return;

        long tokensToAdd = periods * refillTokens;
        availableTokens = Math.min(capacity, availableTokens + tokensToAdd);
        lastRefillTimeNanos = lastRefillTimeNanos + (periods * refillPeriodNanos);
    }
}
