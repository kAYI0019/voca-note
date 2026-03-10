package com.vocanote.api.controller;

import com.vocanote.service.VocaService;
import com.vocanote.api.dto.PageResponse;
import com.vocanote.api.dto.TagTreeNodeResponse;
import com.vocanote.api.dto.VocaCreateRequest;
import com.vocanote.api.dto.VocaResponse;
import com.vocanote.api.dto.VocaStudyScoreRequest;
import com.vocanote.api.dto.VocaUpdateRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/voca")
public class VocaController {

    private final VocaService vocaService;

    public VocaController(VocaService vocaService) {
        this.vocaService = vocaService;
    }

    @PostMapping
    public VocaResponse create(@Valid @RequestBody VocaCreateRequest request) {
        return vocaService.create(request);
    }

    @GetMapping
    public PageResponse<VocaResponse> list(
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestParam(value = "keyword", required = false) @Size(max = 200) String keyword,
            @RequestParam(value = "tag", required = false) @Size(max = 100) String tag
    ) {
        PageRequest pageable = PageRequest.of(
                Math.max(page, 0),
                Math.min(Math.max(size, 1), 100),
                Sort.by(Sort.Direction.DESC, "createdAt")
        );

        Page<VocaResponse> result = vocaService.list(keyword, tag, pageable);

        return new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages()
        );
    }

    @GetMapping("/tags")
    public List<String> listTags() {
        return vocaService.listTags();
    }

    @GetMapping("/tags/tree")
    public List<TagTreeNodeResponse> listTagTree() {
        return vocaService.listTagTree();
    }

    @GetMapping("/{id}")
    public VocaResponse get(@PathVariable("id") Long id) {
        return vocaService.get(id);
    }

    @PutMapping("/{id}")
    public VocaResponse update(@PathVariable("id") Long id, @Valid @RequestBody VocaUpdateRequest request) {
        return vocaService.update(id, request);
    }

    @PostMapping("/{id}/study-score")
    public VocaResponse addStudyScore(@PathVariable("id") Long id, @Valid @RequestBody VocaStudyScoreRequest request) {
        return vocaService.addStudyScore(id, request);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable("id") Long id) {
        vocaService.delete(id);
    }
}
