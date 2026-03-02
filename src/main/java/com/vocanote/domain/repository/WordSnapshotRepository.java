package com.vocanote.domain.repository;

import com.vocanote.domain.model.SnapshotStatus;
import com.vocanote.domain.model.WordSnapshot;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WordSnapshotRepository extends JpaRepository<WordSnapshot, Long> {
    Optional<WordSnapshot> findByLangAndWordNorm(String lang, String wordNorm);
    List<WordSnapshot> findAllByLangAndWordNormInAndStatus(String lang, Collection<String> wordNorm, SnapshotStatus status);

    @Query("""
            select s.wordNorm from WordSnapshot s
            where s.lang = :lang
              and s.status = :status
              and lower(s.wordNorm) like lower(concat('%', :keyword, '%'))
            order by
              case when lower(s.wordNorm) like lower(concat(:keyword, '%')) then 0 else 1 end,
              length(s.wordNorm),
              lower(s.wordNorm)
            """)
    List<String> findWordNormsForSuggest(
            @Param("lang") String lang,
            @Param("status") SnapshotStatus status,
            @Param("keyword") String keyword,
            Pageable pageable
    );
}
