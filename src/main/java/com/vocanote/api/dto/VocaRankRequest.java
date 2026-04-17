package com.vocanote.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record VocaRankRequest(
        @NotNull @Min(0) @Max(5) Integer rank
) { }
