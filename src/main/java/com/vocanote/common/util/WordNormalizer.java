package com.vocanote.common.util;

public final class WordNormalizer {

    private WordNormalizer() { }

    public static String normalizeQuery(String q) {
        // 검색시 사용
        if (q == null) return "";
        return q.trim().toLowerCase();
    }

    public static String normalizeWord(String word) {
        // 조회 및 저장시 사용
        if (word == null) return "";
        return word.trim().toLowerCase();
    }
}
