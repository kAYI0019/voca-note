package com.vocanote.service.port;

import com.vocanote.service.model.SuggestCandidate;

import java.util.List;

public interface SuggestPort {
    List<SuggestCandidate> suggest(String query, int max);
}
