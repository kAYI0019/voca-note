package com.vocanote.api.controller;

import com.vocanote.service.VocaService;
import com.vocanote.api.dto.VocaCsvExportRequest;
import com.vocanote.api.dto.PageResponse;
import com.vocanote.api.dto.TagTreeNodeResponse;
import com.vocanote.api.dto.VocaCreateRequest;
import com.vocanote.api.dto.VocaRankRequest;
import com.vocanote.api.dto.VocaResponse;
import com.vocanote.api.dto.VocaStudyScoreRequest;
import com.vocanote.api.dto.VocaUpdateRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

@Validated
@RestController
@RequestMapping("/api/voca")
public class VocaController {
    private static final DateTimeFormatter EXPORT_FILENAME_TIME_FORMATTER =
            DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss").withZone(ZoneId.systemDefault());

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
            @RequestParam(value = "tag", required = false) @Size(max = 100) String tag,
            @RequestParam(value = "minRank", required = false) Integer minRank,
            @RequestParam(value = "ranks", required = false) String ranks,
            @RequestParam(value = "rankFirst", defaultValue = "false") boolean rankFirst
    ) {
        PageRequest pageable = PageRequest.of(
                Math.max(page, 0),
                Math.min(Math.max(size, 1), 100),
                Sort.by(Sort.Direction.DESC, "createdAt")
        );

        Integer normalizedMinRank = normalizeMinRank(minRank);
        List<Integer> selectedRanks = parseRanks(ranks);
        Page<VocaResponse> result = vocaService.list(keyword, tag, normalizedMinRank, selectedRanks, rankFirst, pageable);

        return new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages()
        );
    }

    private Integer normalizeMinRank(Integer minRank) {
        if (minRank == null) {
            return null;
        }
        if (minRank < 0 || minRank > 5) {
            throw new IllegalArgumentException("minRank must be between 0 and 5");
        }
        return minRank;
    }

    private List<Integer> parseRanks(String rawRanks) {
        if (rawRanks == null || rawRanks.isBlank()) {
            return List.of();
        }

        return Arrays.stream(rawRanks.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .map(value -> {
                    try {
                        return Integer.parseInt(value);
                    } catch (NumberFormatException ex) {
                        throw new IllegalArgumentException("ranks must be comma-separated integers between 0 and 5");
                    }
                })
                .peek(rank -> {
                    if (rank < 0 || rank > 5) {
                        throw new IllegalArgumentException("ranks must be between 0 and 5");
                    }
                })
                .distinct()
                .sorted()
                .collect(Collectors.toList());
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

    @PatchMapping("/{id}/rank")
    public VocaResponse setRank(@PathVariable("id") Long id, @Valid @RequestBody VocaRankRequest request) {
        return vocaService.setRank(id, request.rank());
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable("id") Long id) {
        vocaService.delete(id);
    }

    @PostMapping(value = "/export/csv", produces = "text/csv")
    public ResponseEntity<byte[]> exportCsv(@Valid @RequestBody VocaCsvExportRequest request) {
        String csv = vocaService.exportCsv(request);
        String timestamp = EXPORT_FILENAME_TIME_FORMATTER.format(Instant.now());
        String filename = "voca_export_" + timestamp + ".csv";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(filename, StandardCharsets.UTF_8)
                        .build()
                        .toString())
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }
}
