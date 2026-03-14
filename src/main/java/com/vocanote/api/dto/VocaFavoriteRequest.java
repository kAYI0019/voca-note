package com.vocanote.api.dto;

import jakarta.validation.constraints.NotNull;

public record VocaFavoriteRequest(
        @NotNull Boolean favorite
) { }
