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
              and (:favoriteOnly = false or v.favorite = true)
            order by
              case when :favoriteFirst = true and v.favorite = true then 0 else 1 end,
              v.createdAt desc
            """)
    Page<VocaItem> search(
            @Param("keyword") String keyword,
            @Param("favoriteOnly") boolean favoriteOnly,
            @Param("favoriteFirst") boolean favoriteFirst,
            Pageable pageable
    );

    @Query("""
            select distinct v from VocaItem v
            join v.tags t
            where (lower(t) = lower(:tag) or lower(t) like lower(concat(:tag, '/%')))
              and (:keyword is null or :keyword = '' 
                   or lower(v.word) like lower(concat('%', :keyword, '%'))
                   or lower(coalesce(v.meaningKo, '')) like lower(concat('%', :keyword, '%')))
              and (:favoriteOnly = false or v.favorite = true)
            order by
              case when :favoriteFirst = true and v.favorite = true then 0 else 1 end,
              v.createdAt desc
            """)
    Page<VocaItem> searchByTag(
            @Param("keyword") String keyword,
            @Param("tag") String tag,
            @Param("favoriteOnly") boolean favoriteOnly,
            @Param("favoriteFirst") boolean favoriteFirst,
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
}
