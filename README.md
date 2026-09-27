# Quran and Hadith Fetcher

بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

Quran and Hadith Fetcher is an Obsidian plugin that fetches Quran Ayaat and also Ahadith from multiple online sources. It also has some additional features useful for the seeker of Islamic knowledge like: previewing the Quran/Hadith before inserting, optional offline databases, and other useful text formatting options.

It supports multiple languages, translations, and Ahadith books (depending on the provider).

## Usage

Run these commands in the command palette (`Ctrl-p`)

| Command      | Description                                    |
| ------------ | ---------------------------------------------- |
| Fetch Quran  | Get Quranic Ayaat. Supports ranges like 10-15. |
| Fetch Hadith | Get Ahadith. Also supports ranges.             |

> Fetching is limited to 30 Ayaat and 15 Ahadith to prevent accidental fetches and resource usage. These can easily be modified in the settings.

## Command: Fetch Quran

- **Select a Surah**: Choose from a conveniently sorted list.
- **Fetch Specific Ayat**: Input a single Ayah (e.g., 10) or a custom range (e.g., 10-15).
- **Customize Content**: Toggle Arabic text, English translation, embedded links, and footnotes.
- **Adjust Layout**: Format the final output to display merged into a paragraph or separated line-by-line.

> Tip: Use root words to get your Surah/Hadith Book more easily, like `frq` to get `025 Al-Furqaan`

## Command: Fetch Ahadith

- **Select a Hadith Book**: Choose from a list of Ahadith books (according to the provider set in settings).
- **Fetch Specific Ayat**: Input a single or multiple Ahadith (e.g., `5` or `5-10`)
- **Customize Content**: Toggle Arabic text, English translation, embedded links, and Grading.

## Preview Window

After choosing output options for both the above commands, the plugin opens an editable preview. Here you can either modify the text to your liking before inserting it in current note or copying it.

## Other Commands

These commands can be enabled from the settings

| Command                                                                | Description                                                                                                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Set Hadith content provider`                                          | Select the default API or database provider used to fetch Hadith data.                                                                          |
| `Set Quran translation`                                                | Choose the preferred Quran translator or translation edition (e.g., Sahih International).                                                       |
| `Set Quran content provider`                                           | Choose the source API or data engine used for retrieving Quranic text.                                                                          |
| `Normalize all salutations to ﷺ`                                       | Convert all Prophet honorifics/salutations in the selection to the Arabic symbol ﷺ.                                                             |
| `Convert Variants of RA used for the Sahaba to رَضِيَ ٱللَّٰهُ عَنْهُ` | Standardize text variations of "RA" for Companions into Arabic (رَضِيَ ٱللَّٰهُ عَنْهُ). Also works on "May Allah be pleased with him/her/them" |
| `Check provider health`                                                | Verify server status and network connectivity for active content providers.                                                                     |
| `Toggle Text Conversions`                                              | Quickly enable or disable automatic text conversions                                                                                            |
| `Manage offline databases`                                             | Open the database management modal used for downloading and removing databases for offline use.                                                 |
| `Set Quran link website`                                               | Configure the website used when embedding website link in fetched Ayaat                                                                         |
| `Set Hadith translation`                                               | Set the default translation for Hadith text.                                                                                                    |
| `Set Quran translation language`                                       | Select the primary language for Quran translations.                                                                                             |

# Settings and commands

Settings include provider and translation selection, Quran link destination, formatting, text conversions, range limits, cache control, provider health checks, offline database management, and command-palette visibility.

The two fetch commands and provider health check are enabled by default, along with salutation normalization. Other provider-selection, offline-management, and conversion commands are available in the command palette and can be enabled or disabled in **Command palette commands**.

## Providers

Quran and Hadith providers are selected independently in **Settings → Provider Settings for Quran & Hadith**. Available translations and collections depend on the selected provider.

**Network use:** Fetching a passage sends its selected Quran/Hadith reference and translation choice to the selected provider. Loading catalogs and installing offline databases also requests that provider's service or published data files; health checks contact each configured provider. These requests retrieve passage content, metadata, or offline data. The plugin does not send the note body.

| Type   | Provider                                                            | Available data                                                                                                    |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Quran  | [Al Quran Cloud](https://alquran.cloud)                             | Arabic Quran text and translations discovered from its edition catalog.                                           |
| Quran  | [Quran Unlocked](https://quran.islamunlocked.com/quran)             | Arabic text and English translations listed by the provider adapter.                                              |
| Quran  | [Quran API](https://github.com/fawazahmed0/quran-api)               | Arabic text and translations discovered from its edition catalog.                                                 |
| Quran  | [Quran Project API](https://github.com/The-Quran-Project/Quran-API) | Arabic text and English, Bengali, and Urdu translations.                                                          |
| Hadith | [hadith-api](https://github.com/fawazahmed0/hadith-api)             | Collections and translations from its edition catalog, with Arabic and translation editions retrieved separately. |
| Hadith | [Hadith Unlocked](https://hadithunlocked.com)                       | Its supported collection catalog and English translation.                                                         |
| Hadith | [Hadith JSON](https://github.com/AhmedBaset/hadith-json)            | 17 books from the pinned `hadith-json` v1.2.0 dataset, with Arabic and English text.                              |

Providers may differ in the collections, translations, grading, source links, and offline data they expose. The plugin does not guarantee that every number exists in every provider's version of a collection; the provider response is authoritative for an individual Hadith number.

New installs use Al Quran Cloud and hadith-api. English is the default translation language; Hilali-Khan is preferred for Quran where available. Fetch options start with Arabic, English, and links enabled; Hadith grading is enabled by default. Output uses an Obsidian Quote callout unless changed in formatting settings.

> Recommended providers: `Quran Unlocked` and `Al-Quran Cloud` for Quran, and `Hadith Unlocked` then `Hadith-API` for Hadith

## Offline databases and caching

Open **Settings → Offline databases → Manage** or run **Manage offline databases** from the command palette to install or remove available datasets. Offline databases are stored in the vault's Obsidian plugin data directory. The available downloads are:

- **Quran API:** a complete Arabic edition and separate downloadable translation editions.
- **Quran Project API:** the complete Quran with Arabic plus English, Bengali, and Urdu translations, downloaded as 114 Surah files.
- **Hadith Unlocked:** a complete JSON database for each supported collection.
- **hadith-api:** paired Arabic and English editions for collections that provide both.
- **Hadith JSON:** a complete book JSON file for each of its 17 supported books.

Where a provider has a relevant installed database, it checks local data before its runtime cache or network source. Offline coverage depends on which datasets and translations you install. The plugin validates downloaded parts as JSON and installs a database as a unit; cancelled or failed replacement keeps the prior installed copy.

Most provider result caches are bounded, in-memory caches and can be disabled in settings. Hadith JSON is book-oriented: its first online lookup for a book downloads the complete book, then keeps a bounded set in memory and a persistent copy on disk when caching is enabled. Installing that book as an offline database avoids the online download.

## Output and text conversions

Each fetch lets you choose Arabic text, English text, links, and Hadith grading where available. Bukhari and Muslim also show a grading toggle for the default “Sahih” grade used when a provider supplies no grade, so you can hide or include that fallback. Quran ranges can be displayed line by line, merged, alternating Arabic and English, or as numbered lines; Quran footnotes can also be included (Quran Unlocked only). Hadith output can separate the chain of narration (Isnad) from the text (Hadith Unlocked only). Formatting settings control callouts, prefixes/suffixes, text surroundings, ayah-number styles, and code-syntax handling.

Text conversions run on fetched text before formatting. Settings can normalize common ﷺ salutations, convert variants of the Sahaba honorific, simplify selected transliteration marks, and apply enabled English replacement rules in their configured order. The Quran Arabic text path only applies the Arabic salutation normalization; English replacement rules are not applied to Arabic text. Conversions can be disabled with the master **Toggle Text Conversions** setting or command.

The **Normalize all salutations to ﷺ** and **Convert Variants of RA…** commands operate on the current editor selection, or on the current line when there is no selection. They do not process the entire note automatically.

Quran links use a selectable destination (Quran Unlocked, Quran.com, QuranWBW, or a custom template). Custom templates accept `$surah`, `$ayah`, and `$ayahlast`; `$surah` is required. Hadith links use the selected provider's source URL.

> Multiple spaces are converted into a single space automatically

> Hadith-JSON has `\n` in its texts, this is also automatically replaced by a single space.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run check
npm test
npm run build
```

`npm run build` creates the Obsidian plugin bundle, `main.js`. Unit tests use TypeScript compilation and Node's built-in test runner; they do not require live provider requests. `npm run release:prepare` runs the checks and build, verifies release metadata, and copies `main.js`, `manifest.json`, and `styles.css` into the ignored `release/` directory.

## Project layout

```text
src/
  core/       Formatting, transformations, URLs, caching, HTTP, and shared helpers
  domain/     Provider-independent models and interfaces
  parsing/    Reference parsing and validation
  providers/  Quran and Hadith provider adapters and parsers
  obsidian/   Obsidian UI, settings, and Vault storage adapters
  settings/   Defaults and persisted-settings migration
  tests/      Network-free unit tests
scripts/      Release metadata check and release packaging
```

The plugin uses Obsidian's APIs for HTTP and vault storage.

# License

[MIT LICENSE](LICENSE)
