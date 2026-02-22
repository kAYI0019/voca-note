package com.vocanote.common.exception;

public class ExternalApiException extends RuntimeException {

    private final String provider;

    public ExternalApiException(String provider, String message) {
        super(message);
        this.provider = provider;
    }

    public ExternalApiException(String provider, String message, Throwable cause) {
        super(message, cause);
        this.provider = provider;
    }

    public String getProvider() {
        return provider;
    }
}
