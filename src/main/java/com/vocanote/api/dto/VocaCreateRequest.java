package com.vocanote.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Set;

public record VocaCreateRequest(
        @NotBlank @Size(max = 200) String word,
        @Size(max = 500) String meaningKo,
        @Size(max = 1000) String memo,
        Set<@Size(max = 100) String> tags,
        List<@Size(max = 1000) String> examples
) { }
