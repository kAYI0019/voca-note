package com.vocanote.api.dto;

import java.util.List;

public record TagTreeNodeResponse(
        String path,
        String name,
        int depth,
        List<TagTreeNodeResponse> children
) { }
