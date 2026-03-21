package com.vocanote.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record VocaCsvExportRequest(
        @NotEmpty List<@NotBlank String> columns,
        @Size(max = 100) String tag
) { }
