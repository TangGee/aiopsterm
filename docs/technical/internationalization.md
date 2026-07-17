# Internationalization

aiopsterm keeps renderer-facing UI text behind the renderer i18n boundary.

## Locale Messages

- `src/renderer/src/i18n/locales/zhCN.ts` is the key source for `I18nKey`.
- `en-US` is the complete English locale.
- `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `it-IT`, `pt-PT`, `ru-RU`, and `ar-AR` are fully translated: each file overrides every key. They still go through `completeLocaleMessages()` (base `en-US`) so a missing key added later falls back to English instead of breaking the complete-locale invariant. When adding a new key, add it to `zh-CN` and `en-US` first; translate it into the other locale files in the same change when feasible.
- `zh-TW` intentionally stays a small override set on the `zh-CN` base; full Traditional Chinese output comes from the static-text Simplified→Traditional conversion applied at the DOM layer (this behavior is pinned by `tests/i18n-runtime.test.ts`).
- Placeholder names such as `{count}` and `{title}` must stay identical across all locales (test-enforced).

## Legacy Static Text

Some older renderer components still contain static template text, titles, placeholders, and notice strings. `src/renderer/src/i18n/staticText.ts` translates those registered strings at render time while excluding terminal output, editors, user input, code blocks, and contenteditable chat input.

New user-facing text should prefer explicit `t('...')` keys. Add static catalog coverage only when migrating an older component incrementally.

The audit keeps a hash baseline for the current legacy renderer text in `scripts/i18n-legacy-static-text-baseline.json`. This baseline prevents newly added CJK UI literals from passing only because the generic static-text word replacement can remove every Chinese character. When adding or changing renderer UI text, prefer an explicit i18n key. If an incremental migration needs a static fallback, add an exact entry or an intentional static pattern instead of expanding the legacy baseline.

## Database Language Policy

- Database workspace UI uses explicit `database.*` locale keys. `zh-CN` supplies Simplified Chinese; locale files without database-specific overrides inherit their existing complete base locale.
- DB AI normalizes the effective renderer locale to a request-scoped response language: `zh-CN` stays `zh-CN`; all other locales become `en-US`.
- The normalized language is captured when the request is created and is carried through persisted pane and structured-action state. A later settings change does not change the language of an in-flight request.
- Provider system prompts, generated action prompts, and local backend responses must use that captured language and must explicitly require the same response language. Do not rely on the model to infer the application language from SQL or conversation history.
- Preserve operator-entered text, SQL, identifiers, schema metadata, and raw database errors verbatim even when the surrounding prompt scaffold uses another language.

## Tests

Text-dependent E2E tests should either use stable selectors or run with a fixed locale. The current Electron E2E fixtures use fresh user data and the default `zh-CN` language, so existing Chinese text assertions remain deterministic. When adding non-Chinese locale coverage, avoid reusing Chinese `getByText()`, `getByTitle()`, or `hasText` locators without a locale setup step.

## Audit

Run the renderer i18n audit before committing UI text changes:

```bash
npm run audit:i18n
```

The audit scans tracked renderer Vue/TS files and fails when CJK UI text is not covered by explicit i18n keys or the static text catalog. It also runs automatically as the first step of `npm test` and `npm run build`, so hardcoded CJK regressions fail fast.

Known blind spots: the audit only detects CJK text (hardcoded English is not flagged), and it only scans `src/renderer/src` (main/preload/sidecar are out of scope and currently contain no CJK).
