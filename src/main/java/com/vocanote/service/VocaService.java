package com.vocanote.service;

import com.vocanote.service.port.TranslatorPort;
import com.vocanote.common.exception.ConflictException;
import com.vocanote.common.exception.ExternalApiException;
import com.vocanote.common.exception.NotFoundException;
import com.vocanote.common.exception.QuotaExceededException;
import com.vocanote.common.util.WordNormalizer;
import com.vocanote.domain.model.DictionaryPayload;
import com.vocanote.domain.model.SnapshotStatus;
import com.vocanote.domain.model.StudyScoreResult;
import com.vocanote.domain.model.VocaItem;
import com.vocanote.domain.repository.VocaItemRepository;
import com.vocanote.domain.repository.WordSnapshotRepository;
import com.vocanote.api.dto.TagTreeNodeResponse;
import com.vocanote.api.dto.VocaCreateRequest;
import com.vocanote.api.dto.VocaResponse;
import com.vocanote.api.dto.VocaStudyScoreRequest;
import com.vocanote.api.dto.VocaUpdateRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class VocaService {
    private static final String LANG_EN = "en";

    private final VocaItemRepository vocaItemRepository;
    private final WordSnapshotRepository wordSnapshotRepository;
    private final TranslatorPort translatorPort;

    public VocaService(
            VocaItemRepository vocaItemRepository,
            WordSnapshotRepository wordSnapshotRepository,
            TranslatorPort translatorPort
    ) {
        this.vocaItemRepository = vocaItemRepository;
        this.wordSnapshotRepository = wordSnapshotRepository;
        this.translatorPort = translatorPort;
    }

    @Transactional
    public VocaResponse create(VocaCreateRequest req) {
        String word = WordNormalizer.normalizeWord(req.word());

        if (vocaItemRepository.existsByWordIgnoreCase(word)) {
            throw new ConflictException("Already exists: " + word);
        }

        String meaningKo = normalizeNullable(req.meaningKo());
        if (meaningKo == null || meaningKo.isBlank()) {
            try {
                meaningKo = translatorPort.translateToKo(word).orElse(null);
            } catch (QuotaExceededException | ExternalApiException ex) {
                // 번역 실패해도 저장은 가능하게(사용자가 직접 의미를 채울 수 있음)
                meaningKo = null;
            } catch (Exception ex) {
                meaningKo = null;
            }
        }

        VocaItem saved = vocaItemRepository.save(new VocaItem(
                word,
                meaningKo,
                normalizeNullable(req.memo()),
                normalizeTags(req.tags()),
                req.examples()
        ));

        return toResponse(saved, findSnapshotByWord(saved.getWord()));
    }

    @Transactional(readOnly = true)
    public Page<VocaResponse> list(String keyword, String tag, boolean favoriteOnly, boolean favoriteFirst, Pageable pageable) {
        String k = normalizeNullable(keyword);
        String t = normalizeNullable(tag);

        Page<VocaItem> items;
        if (t != null && !t.isBlank()) {
            items = vocaItemRepository.searchByTag(k, t, favoriteOnly, favoriteFirst, pageable);
        } else {
            items = vocaItemRepository.search(k, favoriteOnly, favoriteFirst, pageable);
        }

        Map<String, SnapshotPhonetics> phoneticsByWord = wordSnapshotRepository
                .findAllByLangAndWordNormInAndStatus(
                        LANG_EN,
                        items.getContent().stream()
                                .map(VocaItem::getWord)
                                .collect(Collectors.toSet()),
                        SnapshotStatus.OK
                )
                .stream()
                .collect(Collectors.toMap(
                        s -> s.getWordNorm(),
                        s -> toPhonetics(s.getDictPayload()),
                        (left, right) -> left
                ));

        return items.map(item -> toResponse(item, phoneticsByWord.get(item.getWord())));
    }

    @Transactional(readOnly = true)
    public List<String> listTags() {
        return vocaItemRepository.findAllDistinctTags().stream()
                .map(this::normalizeTagPath)
                .filter(tag -> tag != null && !tag.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new))
                .stream()
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<TagTreeNodeResponse> listTagTree() {
        MutableTagNode root = new MutableTagNode("", "", -1);

        for (String tagPath : listTags()) {
            List<String> parts = splitTagPath(tagPath);
            if (parts.isEmpty()) {
                continue;
            }

            StringBuilder currentPath = new StringBuilder();
            MutableTagNode currentNode = root;

            for (int depth = 0; depth < parts.size(); depth += 1) {
                String part = parts.get(depth);
                if (currentPath.length() > 0) {
                    currentPath.append('/');
                }
                currentPath.append(part);

                String path = currentPath.toString();
                MutableTagNode nextNode = currentNode.childrenByPath.get(path);
                if (nextNode == null) {
                    nextNode = new MutableTagNode(path, part, depth);
                    currentNode.childrenByPath.put(path, nextNode);
                }
                currentNode = nextNode;
            }
        }

        return toTagTreeResponse(root);
    }

    @Transactional(readOnly = true)
    public VocaResponse get(Long id) {
        VocaItem item = vocaItemRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Not found: " + id));
        return toResponse(item, findSnapshotByWord(item.getWord()));
    }

    @Transactional
    public VocaResponse update(Long id, VocaUpdateRequest req) {
        VocaItem item = vocaItemRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Not found: " + id));

        item.update(
                normalizeNullable(req.meaningKo()),
                normalizeNullable(req.memo()),
                normalizeTags(req.tags()),
                req.examples()
        );

        return toResponse(item, findSnapshotByWord(item.getWord()));
    }

    @Transactional
    public VocaResponse addStudyScore(Long id, VocaStudyScoreRequest req) {
        VocaItem item = vocaItemRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Not found: " + id));

        StudyScoreResult result = req.result();
        item.addStudyResult(result);

        return toResponse(item, findSnapshotByWord(item.getWord()));
    }

    @Transactional
    public VocaResponse setFavorite(Long id, boolean favorite) {
        VocaItem item = vocaItemRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Not found: " + id));

        item.setFavorite(favorite);
        return toResponse(item, findSnapshotByWord(item.getWord()));
    }

    @Transactional
    public void migrateFavorites(Set<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }

        vocaItemRepository.findAllById(ids).forEach(item -> item.setFavorite(true));
    }

    @Transactional
    public void delete(Long id) {
        if (!vocaItemRepository.existsById(id)) {
            throw new NotFoundException("Not found: " + id);
        }
        vocaItemRepository.deleteById(id);
    }

    private VocaResponse toResponse(VocaItem v, SnapshotPhonetics phonetics) {
        Set<String> tags = v.getTags() == null ? Set.of() : new LinkedHashSet<>(v.getTags());
        List<String> examples = v.getExamples() == null ? List.of() : new ArrayList<>(v.getExamples());

        return new VocaResponse(
                v.getId(),
                v.getWord(),
                phonetics != null ? phonetics.ipa() : null,
                phonetics != null ? phonetics.audioUrl() : null,
                v.getMeaningKo(),
                v.getMemo(),
                tags,
                examples,
                v.isFavorite(),
                v.getStudyCorrectCount(),
                v.getStudyPartialCount(),
                v.getStudyWrongCount(),
                v.getCreatedAt(),
                v.getUpdatedAt()
        );
    }

    private SnapshotPhonetics findSnapshotByWord(String word) {
        return wordSnapshotRepository.findByLangAndWordNorm(LANG_EN, WordNormalizer.normalizeWord(word))
                .filter(snapshot -> snapshot.getStatus() == SnapshotStatus.OK)
                .map(snapshot -> toPhonetics(snapshot.getDictPayload()))
                .orElse(null);
    }

    private SnapshotPhonetics toPhonetics(DictionaryPayload payload) {
        if (payload == null) return null;
        return new SnapshotPhonetics(payload.ipa(), payload.audioUrl());
    }

    private record SnapshotPhonetics(
            String ipa,
            String audioUrl
    ) { }

    private List<TagTreeNodeResponse> toTagTreeResponse(MutableTagNode root) {
        return root.childrenByPath.values().stream()
                .map(node -> new TagTreeNodeResponse(
                        node.path,
                        node.name,
                        node.depth,
                        toTagTreeResponse(node)
                ))
                .toList();
    }

    private Set<String> normalizeTags(Set<String> tags) {
        if (tags == null) {
            return null;
        }

        List<String> normalized = tags.stream()
                .map(this::normalizeTagPath)
                .filter(tag -> tag != null && !tag.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new))
                .stream()
                .toList();

        List<String> sortedBySpecificity = normalized.stream()
                .sorted(Comparator
                        .comparingInt((String tag) -> splitTagPath(tag).size())
                        .thenComparingInt(String::length)
                        .reversed())
                .toList();

        List<String> kept = new ArrayList<>();
        for (String candidate : sortedBySpecificity) {
            boolean hasDescendant = kept.stream().anyMatch(existing -> existing.startsWith(candidate + "/"));
            if (!hasDescendant) {
                kept.add(candidate);
            }
        }

        kept.sort(String.CASE_INSENSITIVE_ORDER);
        return new LinkedHashSet<>(kept);
    }

    private String normalizeTagPath(String rawTagPath) {
        if (rawTagPath == null) {
            return null;
        }

        List<String> parts = splitTagPath(rawTagPath);
        if (parts.isEmpty()) {
            return null;
        }
        return String.join("/", parts);
    }

    private List<String> splitTagPath(String rawTagPath) {
        if (rawTagPath == null) {
            return List.of();
        }

        return Arrays.stream(rawTagPath.split("/"))
                .map(String::trim)
                .filter(part -> !part.isBlank())
                .toList();
    }

    private static final class MutableTagNode {
        private final String path;
        private final String name;
        private final int depth;
        private final Map<String, MutableTagNode> childrenByPath = new java.util.LinkedHashMap<>();

        private MutableTagNode(String path, String name, int depth) {
            this.path = path;
            this.name = name;
            this.depth = depth;
        }
    }

    private String normalizeNullable(String s) {
        return s == null ? null : s.trim();
    }
}
