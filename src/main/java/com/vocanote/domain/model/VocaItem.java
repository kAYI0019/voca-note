package com.vocanote.domain.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(
        name = "voca_item",
        indexes = {
                @Index(name = "idx_voca_item_word", columnList = "word")
        }
)
@EntityListeners(AuditingEntityListener.class)
public class VocaItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String word;

    @Column(name = "meaning_ko", length = 500)
    private String meaningKo;

    @Column(length = 1000)
    private String memo;

    @ElementCollection
    @CollectionTable(name = "voca_item_tag", joinColumns = @JoinColumn(name = "voca_item_id"))
    @Column(name = "tag", length = 100)
    private Set<String> tags = new LinkedHashSet<>();

    @ElementCollection
    @CollectionTable(name = "voca_item_example", joinColumns = @JoinColumn(name = "voca_item_id"))
    @Column(name = "example", length = 1000)
    private List<String> examples = new ArrayList<>();

    @Column(name = "study_correct_count", nullable = false)
    private int studyCorrectCount = 0;

    @Column(name = "study_partial_count", nullable = false)
    private int studyPartialCount = 0;

    @Column(name = "study_wrong_count", nullable = false)
    private int studyWrongCount = 0;

    @Column(nullable = false)
    private boolean favorite = false;

    @CreatedDate
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    @Column(nullable = false)
    private Instant updatedAt;

    public VocaItem(String word, String meaningKo, String memo, Set<String> tags, List<String> examples) {
        this.word = word;
        this.meaningKo = meaningKo;
        this.memo = memo;
        if (tags != null) this.tags = new LinkedHashSet<>(tags);
        if (examples != null) this.examples = new ArrayList<>(examples);
    }

    public void update(String meaningKo, String memo, Set<String> tags, List<String> examples) {
        if (meaningKo != null) this.meaningKo = meaningKo;
        if (memo != null) this.memo = memo;
        if (tags != null) this.tags = new LinkedHashSet<>(tags);
        if (examples != null) this.examples = new ArrayList<>(examples);
    }

    public void addStudyResult(StudyScoreResult result) {
        if (result == null) {
            return;
        }

        switch (result) {
            case CORRECT -> this.studyCorrectCount += 1;
            case PARTIAL -> this.studyPartialCount += 1;
            case WRONG -> this.studyWrongCount += 1;
        }
    }

    public void setFavorite(boolean favorite) {
        this.favorite = favorite;
    }
}
