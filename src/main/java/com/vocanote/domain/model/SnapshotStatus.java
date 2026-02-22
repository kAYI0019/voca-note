package com.vocanote.domain.model;

public enum SnapshotStatus {
    OK,        // 정상 조회 캐시
    NOT_FOUND, // 없는 단어(negative cache)
    ERROR      // 외부 API 오류 캐시(짧게)
}
