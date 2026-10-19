# Study Response Policy Specification

## Purpose

Define the concise Spanish study result selected from visible viewport content.

## Requirements

### Requirement: Questionnaire-first response

When visible questionnaire blocks are detected, blocks nearest the viewport center MUST take priority over other content. The response SHALL reveal each detected correct option directly, without reasoning or explanatory text.

#### Scenario: Centered questionnaire
- GIVEN a visible questionnaire block near the viewport center and unrelated surrounding content
- WHEN the viewport is analyzed
- THEN the response MUST contain the questionnaire answer rather than a content summary

#### Scenario: Single visible question
- GIVEN one prioritized visible question whose correct option is `C`
- WHEN analysis succeeds
- THEN the response MUST identify `C` directly and MUST NOT include reasoning

### Requirement: Compact multiple-answer format

When multiple questions are visible in the prioritized questionnaire content, the response MUST list answers in visible question order using a compact numbered format equivalent to `1: A · 2: C · 3: B`.

#### Scenario: Multiple visible questions
- GIVEN three visible prioritized questions with correct options A, C, and B
- WHEN analysis succeeds
- THEN the response MUST be `1: A · 2: C · 3: B` or preserve that exact compact structure
- AND it MUST NOT include answer explanations

### Requirement: Non-questionnaire study response

When no questionnaire is detected, the system MUST return a useful Spanish summary or explanation of the main relevant visible content. The final response MUST be concise and MUST NOT exceed 60 words.

#### Scenario: Explanatory content
- GIVEN visible study content with no questionnaire
- WHEN analysis succeeds
- THEN the response MUST be in Spanish, address the main relevant content, and contain at most 60 words

#### Scenario: Provider returns excessive text
- GIVEN a non-questionnaire provider result longer than 60 words
- WHEN the result is prepared for the user
- THEN the delivered response MUST be reduced to at most 60 words
