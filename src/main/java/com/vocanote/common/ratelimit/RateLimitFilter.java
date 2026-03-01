package com.vocanote.common.ratelimit;

import com.vocanote.common.web.ErrorResponse;
import com.vocanote.config.RateLimitProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.jspecify.annotations.NonNull;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimitProperties props;
    private final ObjectMapper objectMapper;

    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();

    public RateLimitFilter(RateLimitProperties props, ObjectMapper objectMapper) {
        this.props = props;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/actuator")
                || path.startsWith("/h2-console")
                || path.startsWith("/favicon.ico");
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {

        String category = categoryOf(request.getRequestURI());
        if (category == null) {
            filterChain.doFilter(request, response);
            return;
        }

        TokenBucket bucket = bucketFor(clientIp(request), category);
        if (bucket.tryConsume()) {
            filterChain.doFilter(request, response);
            return;
        }

        // 429
        response.setStatus(429);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);

        ErrorResponse body = new ErrorResponse(
                Instant.now(),
                429,
                "Too Many Requests",
                "Rate limit exceeded (" + category + "). Please try again later.",
                request.getRequestURI()
        );

        objectMapper.writeValue(response.getOutputStream(), body);
    }

    private TokenBucket bucketFor(String ip, String category) {
        String key = category + ":" + ip;

        return buckets.computeIfAbsent(key, k -> {
            RateLimitProperties.Rule rule = switch (category) {
                case "suggest" -> props.suggest();
                case "entry" -> props.entry();
                case "voca" -> props.voca();
                default -> null;
            };

            if (rule == null) {
                // fallback
                return new TokenBucket(10, 5, java.time.Duration.ofSeconds(1));
            }
            return new TokenBucket(rule.capacity(), rule.refillTokens(), rule.refillPeriod());
        });
    }

    private String categoryOf(String path) {
        if (path.startsWith("/api/suggest")) return "suggest";
        if (path.startsWith("/api/entry")) return "entry";
        if (path.startsWith("/api/voca")) return "voca";
        return null;
    }

    private String clientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            // "client, proxy1, proxy2"
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr() != null ? request.getRemoteAddr() : "unknown";
    }
}
