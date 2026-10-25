# RA Conversions

Every source form below is converted to Arabic by `normalizeStandaloneRa()` in
`src/core/normalization.ts`. This runs when you use the **Convert Variants of RA used for the
Sahaba** command and when fetched text is transformed (if `raNormalization` is on).

## The rule

Only the RA honorific **words** are replaced. Whatever encloses them is left alone, and parentheses
are **never added**:

| Source | Result | Why |
| --- | --- | --- |
| `RA` | `رَضِيَ ٱللَّٰهُ عَنْهُ` | no enclosure, so the bare Arabic is used |
| `(RA)` | `(رَضِيَ ٱللَّٰهُ عَنْهُ)` | the source parentheses are kept |
| `[R.A.]` | `[رَضِيَ ٱللَّٰهُ عَنْهُ]` | the source brackets are kept |
| `"R.A."` | `"رَضِيَ ٱللَّٰهُ عَنْهُ"` | the source quotes are kept |
| `( R.A. )` | `(رَضِيَ ٱللَّٰهُ عَنْهُ)` | inner spacing is tidied inside existing parentheses |
| `May Allah be pleased with him` | `رضي اللّه عنه` | no parentheses added |
| `[May Allah be pleased with her]` | `[رضي اللّه عنها]` | the source brackets are kept |
| `Jabir (may Allah be pleased with him) said` | `Jabir (رضي اللّه عنه) said` | words converted, parentheses kept |

Enclosures the source did not supply are never introduced, and enclosures the source did supply are
never removed. The one exception is the comma-wrapped wordings listed in section 3, which keep their
existing comma-collapsing behaviour.

Surrounding whitespace and punctuation are otherwise left where the source put them:

- `Jabir may Allah be pleased with him said` → `Jabir رضي اللّه عنه said`
- `May Allah be pleased with him, and more` → `رضي اللّه عنه, and more`
- `RA.` → `رَضِيَ ٱللَّٰهُ عَنْهُ.`
- `RA,` → `رَضِيَ ٱللَّٰهُ عَنْهُ,`

---

## 1. Abbreviations and acronyms

| Input | Output |
| --- | --- |
| `RA` | `رَضِيَ ٱللَّٰهُ عَنْهُ` |
| `R.A` | `رَضِيَ ٱللَّٰهُ عَنْهُ` |
| `R.A.` | `رَضِيَ ٱللَّٰهُ عَنْهُ` |
| `ra` / `r.a.` | `رَضِيَ ٱللَّٰهُ عَنْهُ` |
| `(RA)` | `(رَضِيَ ٱللَّٰهُ عَنْهُ)` |
| `(R.A.)` | `(رَضِيَ ٱللَّٰهُ عَنْهُ)` |
| `[R.A.]` | `[رَضِيَ ٱللَّٰهُ عَنْهُ]` |
| `"R.A."` | `"رَضِيَ ٱللَّٰهُ عَنْهُ"` |
| `( R.A. )` | `(رَضِيَ ٱللَّٰهُ عَنْهُ)` |
| `X RA Y` | `X رَضِيَ ٱللَّٰهُ عَنْهُ Y` |

Examples:

- `Start,R.A. (R.A.)` → `Start,رَضِيَ ٱللَّٰهُ عَنْهُ (رَضِيَ ٱللَّٰهُ عَنْهُ)`
- `Abu Hurayrah RA said` → `Abu Hurayrah رَضِيَ ٱللَّٰهُ عَنْهُ said`

The abbreviation output is the fully vocalized form `رَضِيَ ٱللَّٰهُ عَنْهُ`. The
English phrases in section 2 use `رضي اللّه عنه`.

## 2. English phrases → Arabic by pronoun

| Input | Output |
| --- | --- |
| `May Allah be pleased with him` | `رضي اللّه عنه` |
| `may Allah be pleased with him` | `رضي اللّه عنه` |
| `May Allah be pleased with her` | `رضي اللّه عنها` |
| `May Allah be pleased with them` | `رضي اللّه عنهم` |
| `(May Allah be pleased with Him)` | `(رضي اللّه عنه)` |
| `(May Allah be pleased with Her)` | `(رضي اللّه عنها)` |
| `(May Allah be pleased with them)` | `(رضي اللّه عنهم)` |
| `[May Allah be pleased with him]` | `[رضي اللّه عنه]` |
| `"May Allah be pleased with them"` | `"رضي اللّه عنهم"` |
| `( may Allah be pleased with him )` | `(رضي اللّه عنه)` |

Examples:

- `Muhammad (May Allah be pleased with him) said` → `Muhammad (رضي اللّه عنه) said`
- `Jabir [may Allah be pleased with him] said` → `Jabir [رضي اللّه عنه] said`
- `May Allah be pleased with him.` → `رضي اللّه عنه.`

Matching is case-insensitive.

## 3. Comma-wrapped wordings → space + bare Arabic

These forms consume their wrapping commas and leave exactly one space before the Arabic. This is the
only place where surrounding punctuation is removed.

| Input | Output |
| --- | --- |
| `, may Allah be pleased with him,` | ` رضي اللّه عنه` |
| `, may Allah be pleased with her,` | ` رضي اللّه عنها` |
| `, may Allah be pleased with them,` | ` رضي اللّه عنهم` |
| `Jabir, may Allah be pleased with them,` | `Jabir رضي اللّه عنهم` |
| `Jabir, may Allah be pleased with her said` | `Jabir رضي اللّه عنها said` |

Examples:

- `Jabir, may Allah be pleased with him, said` → `Jabir رضي اللّه عنه said`
- `Jabir, may Allah be pleased with them, and more` → `Jabir رضي اللّه عنهم and more`

## 4. Arabic forms (left exactly as written)

| Input | Output |
| --- | --- |
| `رَضِيَ ٱللَّٰهُ عَنْهُ` | `رَضِيَ ٱللَّٰهُ عَنْهُ` |
| `( رضي اللّه عنه )` | `( رضي اللّه عنه )` (source spacing preserved) |
| `(رضي اللّه عنها)` | `(رضي اللّه عنها)` |
| `Muhammad رَضِيَ ٱللَّٰهُ عَنْهُ said` | `Muhammad رَضِيَ ٱللَّٰهُ عَنْهُ said` |

Existing Arabic RA wording is protected before conversion, so its spacing and enclosure are not
normalized. Normalization is idempotent: running it twice produces the same result as running it
once.

---

## Not converted

These forms are deliberately left alone today:

- `R A` (spaced letters)
- Lowercase and embedded lookalikes such as `RAma` when they are part of a word
- Dotted sequences with further letters, e.g. `R.A.S.`
- Any Arabic spelling outside the forms listed in section 4
- The phrase inside a larger English word or without the exact wording "May Allah be pleased with
  him/her/them"

## Source of truth

| Where | What it defines |
| --- | --- |
| `src/core/normalization.ts` | `RA_ENGLISH_PATTERNS`, `STANDALONE_RA_PATTERN`, `normalizeStandaloneRa()` |
| `src/tests/unit/normalization.test.ts` | Expected output for each conversion group, including enclosure preservation |
| `src/main.ts` | `convert-ra` command wiring |
| `src/obsidian/settings-tab.ts` | Text-conversion setting description |
