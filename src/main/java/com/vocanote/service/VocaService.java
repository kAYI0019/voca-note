package com.vocanote.service;

import com.vocanote.service.port.TranslatorPort;
import com.vocanote.common.exception.ConflictException;
import com.vocanote.common.exception.ExternalApiException;
import com.vocanote.common.exception.NotFoundException;
import com.vocanote.common.exception.QuotaExceededException;
import com.vocanote.common.util.WordNormalizer;
import com.vocanote.domain.model.VocaItem;
import com.vocanote.domain.repository.VocaItemRepository;
import com.vocanote.api.dto.VocaCreateRequest;
import com.vocanote.api.dto.VocaResponse;
import com.vocanote.api.dto.VocaUpdateRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VocaService {

    private final VocaItemRepository vocaItemRepository;
    private final TranslatorPort translatorPort;

    public VocaService(VocaItemRepository vocaItemRepository, TranslatorPort translatorPort) {
        this.vocaItemRepository = vocaItemRepository;
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
                req.tags(),
                req.examples()
        ));

        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public Page<VocaResponse> list(String keyword, String tag, Pageable pageable) {
        String k = normalizeNullable(keyword);
        String t = normalizeNullable(tag);

        if (t != null && !t.isBlank()) {
            return vocaItemRepository.searchByTag(k, t, pageable).map(this::toResponse);
        }
        return vocaItemRepository.search(k, pageable).map(this::toResponse);
    }

    @Transactional(readOnly = true)
    public VocaResponse get(Long id) {
        VocaItem item = vocaItemRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Not found: " + id));
        return toResponse(item);
    }

    @Transactional
    public VocaResponse update(Long id, VocaUpdateRequest req) {
        VocaItem item = vocaItemRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Not found: " + id));

        item.update(
                normalizeNullable(req.meaningKo()),
                normalizeNullable(req.memo()),
                req.tags(),
                req.examples()
        );

        return toResponse(item);
    }

    @Transactional
    public void delete(Long id) {
        if (!vocaItemRepository.existsById(id)) {
            throw new NotFoundException("Not found: " + id);
        }
        vocaItemRepository.deleteById(id);
    }

    private VocaResponse toResponse(VocaItem v) {
        return new VocaResponse(
                v.getId(),
                v.getWord(),
                v.getMeaningKo(),
                v.getMemo(),
                v.getTags(),
                v.getExamples(),
                v.getCreatedAt(),
                v.getUpdatedAt()
        );
    }

    private String normalizeNullable(String s) {
        return s == null ? null : s.trim();
    }
}
