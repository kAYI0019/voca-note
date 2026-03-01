package com.vocanote.api.controller;

import com.vocanote.api.dto.SuggestResponse;
import com.vocanote.service.SuggestService;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api")
public class LookupController {

    private final SuggestService suggestService;

    public LookupController(SuggestService suggestService) {
        this.suggestService = suggestService;
    }

    @GetMapping("/suggest")
    public SuggestResponse suggest(
            @RequestParam("q") @NotBlank @Size(max = 100) String q,
            @RequestParam(value = "max", defaultValue = "10") int max
    ) {
        return suggestService.suggest(q, max);
    }

}
