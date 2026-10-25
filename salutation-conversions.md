# Salutation Conversions

Every source form below is converted to the Arabic salutation ligature **ﷺ** (U+FDFA) by
`normalizeBlessing()` in `src/core/normalization.ts`. This runs when you use the **Normalize all
salutations to ﷺ** command and when fetched text is transformed (if `blessingNormalization` is on).

## The rule

Only the salutation **words** are replaced. Whatever encloses them is left alone, and parentheses
are **never added**:

| Source | Result | Why |
| --- | --- | --- |
| `SAW` | `ﷺ` | no enclosure, so the bare glyph is used |
| `(SAW)` | `(ﷺ)` | the source parentheses are kept |
| `[SAW]` | `[ﷺ]` | the source brackets are kept |
| `"SAW"` | `"ﷺ"` | the source quotes are kept |
| `( SAW )` | `(ﷺ)` | inner spacing is tidied inside existing parentheses |
| `Muhammad (peace be upon him) said` | `Muhammad (ﷺ) said` | words converted, parentheses kept |
| `Muhammad peace be upon him said` | `Muhammad ﷺ said` | no parentheses added |

Enclosures the source did not supply are never introduced, and enclosures the source did supply are
never removed. The one exception is the comma-wrapped wordings listed in section 4, which keep
their existing comma-collapsing behaviour.

---

## 1. Abbreviations and acronyms

| Input | Output |
| --- | --- |
| `SAW` | `ﷺ` |
| `(SAW)` | `(ﷺ)` |
| `S.A.W` | `ﷺ` |
| `S.A.W.` | `ﷺ` |
| `S A W` | `ﷺ` |
| `SAWS` | `ﷺ` |
| `(SAWS)` | `(ﷺ)` |
| `S.A.W.S` | `ﷺ` |
| `S.A.W.S.` | `ﷺ` |
| `S A W S` | `ﷺ` |
| `PBUH` | `ﷺ` |
| `(PBUH)` | `(ﷺ)` |
| `P.B.U.H` | `ﷺ` |
| `P.B.U.H.` | `ﷺ` |
| `P B U H` | `ﷺ` |

Examples:

- `Muhammad SAW said` → `Muhammad ﷺ said`
- `(O Muhammad SAW)` → `(O Muhammad ﷺ)`
- `Muhammad [PBUH] said` → `Muhammad [ﷺ] said`
- `SAW.` → `ﷺ.` (trailing punctuation is untouched)

The undotted forms (`SAW`, `SAWS`, `S A W`, `PBUH`, `P B U H`) match **uppercase only**. The dotted
forms (`S.A.W.`, `S.A.W.S.`, `P.B.U.H.`) are case-insensitive.

## 2. English phrases → bare ﷺ

| Input | Output |
| --- | --- |
| `peace be upon him` | `ﷺ` |
| `Peace be upon him` | `ﷺ` |
| `may peace be upon him` | `ﷺ` |
| `May peace be upon him` | `ﷺ` |
| `peace and blessings be upon him` | `ﷺ` |
| `Peace and blessings be upon him` | `ﷺ` |
| `(peace be upon him)` | `(ﷺ)` |
| `(may peace be upon him)` | `(ﷺ)` |
| `(peace and blessings be upon him)` | `(ﷺ)` |

Examples:

- `And he Peace be upon him and he` → `And he ﷺ and he`
- `Muhammad (peace be upon him) said` → `Muhammad (ﷺ) said`
- `Muhammad peace be upon him said` → `Muhammad ﷺ said`

## 3. Parenthesized wordings → (ﷺ)

These wordings are only recognized next to a delimiter, so they need the parentheses in the source.
The parentheses are kept.

| Input | Output |
| --- | --- |
| `(peace and blessings of Allah upon him)` | `(ﷺ)` |
| `(may peace and blessings of Allah upon him)` | `(ﷺ)` |
| `(may Allah bless him and grant him peace)` | `(ﷺ)` |

Examples:

- `Messenger (peace and blessings of Allah upon him)` → `Messenger (ﷺ)`
- `Prophet (may Allah bless him and grant him peace) used` → `Prophet (ﷺ) used`

## 4. Comma-wrapped wordings → space + bare ﷺ

These forms consume their wrapping commas and leave exactly one space before the glyph. This is the
only place where surrounding punctuation is removed.

| Input | Output |
| --- | --- |
| `May peace and blessings be upon him` | `ﷺ` |
| `May peace and blessing be upon him` | `ﷺ` |
| `, may peace and blessing be upon him,` | ` ﷺ` |
| `, peace and blessings of Allah upon him,` | ` ﷺ` |
| `, may peace and blessings of Allah upon him,` | ` ﷺ` |
| `, may Allah bless him and grant him peace` | `ﷺ` |
| `, may Allah bless him and grant him peace,` | `ﷺ` |
| `may Allah bless him and grant him peace` (after a word or comma) | ` ﷺ` |

Examples:

- `And he May peace and blessings be upon him and he` → `And he ﷺ and he`
- `Messenger of Allah, peace and blessings of Allah upon him,` → `Messenger of Allah ﷺ`
- `Prophet, may Allah bless him and grant him peace used` → `Prophet ﷺ used`
- `Muhammad, may Allah bless him and grant him peace, and more` → `Muhammad ﷺ and more`
- `X may Allah bless him and grant him peace used` → `X ﷺ used`
- `, may Allah bless him and grant him peace used` → `ﷺ used` (no leading space at start of text)

## 5. Arabic → bare ﷺ

| Input | Output |
| --- | --- |
| `صلى الله عليه وسلم` | `ﷺ` |
| `صلى الله عليه و سلم` | `ﷺ` |
| `صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ` (with harakat) | `ﷺ` |
| `(صلى الله عليه وسلم)` | `(ﷺ)` |

Examples:

- `قال رسول الله صلى الله عليه وسلم` → `قال رسول الله ﷺ`
- `(Muhammad صلى الله عليه وسلم)` → `(Muhammad ﷺ)` (existing parentheses are kept)
- `صلى الله عليه وسلم.` → `ﷺ.`

## 6. Already-normalized forms (left exactly as written)

| Input | Output |
| --- | --- |
| `ﷺ` | `ﷺ` |
| `(ﷺ)` | `(ﷺ)` |
| `( ﷺ )` | `( ﷺ )` (source spacing preserved) |
| `Muhammad ﷺ said` | `Muhammad ﷺ said` |
| `Muhammad (ﷺ) said` | `Muhammad (ﷺ) said` |

Normalization is idempotent: running it twice produces the same result as running it once.

---

## Not converted

These forms are deliberately left alone today:

- Lowercase undotted abbreviations: `saw`, `pbuh`, `saws`, `s a w`, `p b u h`
- Words that merely contain the letters: `sawmill`, `SAWs` (not treated as a blessing)
- `sallallahu alayhi wa sallam` / `Sallallahu Alaihi Wasallam`
- `peace and blessings of Allah be upon him` (no surrounding commas)
- `may peace and blessings of Allah be upon him` (no surrounding commas)
- `(may peace and blessings of Allah be upon him)` — the recognized wording is
  "…of Allah **upon him**", not "…be upon him"
- A standalone `may Allah bless him and grant him peace` with no preceding word or comma

## Source of truth

| Where | What it defines |
| --- | --- |
| `src/core/normalization.ts` | `ARABIC_PHRASES`, `BARE_ENGLISH_PATTERNS`, `PARENTHESIZED_ENGLISH_PATTERNS`, `ENGLISH_PATTERNS`, `normalizeBlessing()` |
| `src/tests/unit/normalization.test.ts` | Expected output for each conversion group, including enclosure preservation |
| `src/main.ts` | `normalize-salutations` command wiring |
