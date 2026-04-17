package com.vocanote.domain.repository;

import com.vocanote.domain.model.VocaItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface VocaItemRepository extends JpaRepository<VocaItem, Long> {

    boolean existsByWordIgnoreCase(String word);

    Optional<VocaItem> findByWordIgnoreCase(String word);

    @Query("""
            select v from VocaItem v
            where (:keyword is null or :keyword = '' 
                   or lower(v.word) like lower(concat('%', :keyword, '%'))
                   or lower(coalesce(v.meaningKo, '')) like lower(concat('%', :keyword, '%')))
              and (:minRank is null or v.rank >= :minRank)
              and (:selectedRanksEmpty = true or v.rank in :selectedRanks)
            order by
              case when :rankFirst = true then v.rank else 0 end desc,
              v.createdAt desc
            """)
    Page<VocaItem> search(
            @Param("keyword") String keyword,
            @Param("minRank") Integer minRank,
            @Param("selectedRanks") List<Integer> selectedRanks,
            @Param("selectedRanksEmpty") boolean selectedRanksEmpty,
            @Param("rankFirst") boolean rankFirst,
            Pageable pageable
    );

    @Query("""
            select v from VocaItem v
            where exists (
                    select 1 from VocaItem v2
                    join v2.tags t
                    where v2 = v
                      and (lower(t) = lower(:tag) or lower(t) like lower(concat(:tag, '/%')))
            )
              and (:keyword is null or :keyword = '' 
                   or lower(v.word) like lower(concat('%', :keyword, '%'))
                   or lower(coalesce(v.meaningKo, '')) like lower(concat('%', :keyword, '%')))
              and (:minRank is null or v.rank >= :minRank)
              and (:selectedRanksEmpty = true or v.rank in :selectedRanks)
            order by
              case when :rankFirst = true then v.rank else 0 end desc,
              v.createdAt desc
            """)
    Page<VocaItem> searchByTag(
            @Param("keyword") String keyword,
            @Param("tag") String tag,
            @Param("minRank") Integer minRank,
            @Param("selectedRanks") List<Integer> selectedRanks,
            @Param("selectedRanksEmpty") boolean selectedRanksEmpty,
            @Param("rankFirst") boolean rankFirst,
            Pageable pageable
    );

    @Query("""
            select distinct t from VocaItem v
            join v.tags t
            where trim(t) <> ''
            """)
    List<String> findAllDistinctTags();

    @Query("""
            select v.word from VocaItem v
            where lower(v.word) like lower(concat('%', :keyword, '%'))
            order by
              case when lower(v.word) like lower(concat(:keyword, '%')) then 0 else 1 end,
              length(v.word),
              lower(v.word)
            """)
    List<String> findWordsForSuggest(@Param("keyword") String keyword, Pageable pageable);

    List<VocaItem> findAllByOrderByCreatedAtDesc();

    @Query("""
            select v from VocaItem v
            where exists (
                    select 1 from VocaItem v2
                    join v2.tags t
                    where v2 = v
                      and (lower(t) = lower(:tag) or lower(t) like lower(concat(:tag, '/%')))
            )
            order by v.createdAt desc
            """)
    List<VocaItem> findAllByTagPathForExport(@Param("tag") String tag);
}
