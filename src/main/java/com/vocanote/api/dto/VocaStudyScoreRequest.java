package com.vocanote.api.dto;

import com.vocanote.domain.model.StudyScoreResult;
import jakarta.validation.constraints.NotNull;

public record VocaStudyScoreRequest(
        @NotNull StudyScoreResult result
) { }
