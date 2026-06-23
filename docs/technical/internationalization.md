# Internationalization

aiopsterm keeps renderer-facing UI text behind the renderer i18n boundary.

## Locale Messages

- `src/renderer/src/i18n/locales/zhCN.ts` is the key source for `I18nKey`.
- `en-US` is the complete English locale.
- Other locale files define overrides through `completeLocaleMessages()`, which fills missing keys from a base locale so every supported locale has a complete runtime message object. Non-Chinese locales use `en-US`; `zh-TW` uses `zh-CN`.
- Placeholder names such as `{count}` and `{title}` must stay identical across all locales.

## Legacy Static Text

Some older renderer components still contain static template text, titles, placeholders, and notice strings. `src/renderer/src/i18n/staticText.ts` translates those registered strings at render time while excluding terminal output, editors, user input, code blocks, and contenteditable chat input.

New user-facing text should prefer explicit `t('...')` keys. Add static catalog coverage only when migrating an older component incrementally.

## Tests

Text-dependent E2E tests should either use stable selectors or run with a fixed locale. The current Electron E2E fixtures use fresh user data and the default `zh-CN` language, so existing Chinese text assertions remain deterministic. When adding non-Chinese locale coverage, avoid reusing Chinese `getByText()`, `getByTitle()`, or `hasText` locators without a locale setup step.

## Audit

Run the renderer i18n audit before committing UI text changes:

```bash
npm run audit:i18n
```

The audit scans tracked renderer Vue/TS files and fails when CJK UI text is not covered by explicit i18n keys or the static text catalog.
