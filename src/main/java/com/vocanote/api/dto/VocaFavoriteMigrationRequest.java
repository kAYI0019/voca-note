package com.vocanote.api.dto;

import jakarta.validation.constraints.Positive;

import java.util.Set;

public record VocaFavoriteMigrationRequest(
        Set<@Positive Long> ids
) { }
