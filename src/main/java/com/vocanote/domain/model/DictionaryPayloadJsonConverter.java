package com.vocanote.domain.model;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Converter
public class DictionaryPayloadJsonConverter implements AttributeConverter<DictionaryPayload, String> {
    private static final ObjectMapper om = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(DictionaryPayload attribute) {
        if (attribute == null) return null;
        try {
            return om.writeValueAsString(attribute);
        } catch (JacksonException e) {
            throw new IllegalStateException("Failed to serialize DictionaryPayload", e);
        }
    }

    @Override
    public DictionaryPayload convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) return null;
        try {
            return om.readValue(dbData, DictionaryPayload.class);
        } catch (JacksonException e) {
            throw new IllegalStateException("Failed to deserialize DictionaryPayload", e);
        }
    }
}
