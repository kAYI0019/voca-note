package com.vocanote.domain.repository;

import com.vocanote.domain.model.WordSnapshot;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WordSnapshotRepository extends JpaRepository<WordSnapshot, Long> {
    Optional<WordSnapshot> findByLangAndWordNorm(String lang, String wordNorm);
}