# Changelog

## 1.0.7

- Added screenshots of the main workflows to the README, including command, provider, offline database and text conversion settings.
- Added a Quran and Hadith gallery covering final output, selection, formatting and preview screens.
- Clarified the disclaimer to cover scholarly and academic use.

## 1.0.6

- Added build provenance attestations for release assets so downloads can be verified against the source repository.
- Replaced deprecated clipboard fallback code with the standard `navigator.clipboard` API.
- Removed unnecessary type assertions and unsafe `any` handling across the cache, providers, parsers, and settings.
- Replaced bare `setTimeout`, `clearTimeout`, and `requestAnimationFrame` calls with their `window` equivalents for popout-window compatibility.
- Replaced `globalThis` with the popout-aware `activeWindow` for offline database hashing.
- Updated modal callbacks to accept async handlers explicitly, removing unhandled promise warnings.
- Replaced generic `createEl` calls with Obsidian's `createDiv`/`createSpan` helpers.
- Fixed deprecated `execCommand` usage and a non-Error throw in the Hadith API provider.
- Removed unused imports and constants, fixed an unnecessary regex escape, and removed `!important` declarations from the offline filter styles.
- Documented why the imperative settings renderer remains while the plugin supports Obsidian versions before 1.13.

## 1.0.5

- Fixed Hadith Unlocked offline databases not returning Hadith content: installed books use the `book-v44` layout (`chapters[].sections[].items[]`) and are now parsed correctly, including text, isnads, titles and grades.
- Fixed offline Hadith Unlocked lookups silently returning the first Hadith when the requested reference did not match; missing Hadiths now raise a clear error.
- Added offline support for commentary collections such as Ibn Rajab's Fifty, whose entries are numbered by section.
- Offline Hadith Unlocked ranges now read the installed book once, and a small LRU cache makes repeated single fetches instant. The cache is invalidated when the database is reinstalled or removed.
- Decoded HTML entities such as `&gt;` in isnads from downloaded Hadith Unlocked books.
- Salutation conversion now replaces only the salutation words: source parentheses, brackets and quotes are preserved and no parentheses are added.
- RA conversion now preserves source enclosures and surrounding whitespace/punctuation, fixes missing spaces after converted phrases (for example `with him said`), and leaves existing Arabic RA text untouched.
- Added `salutation-conversions.md` and `ra-conversions.md` reference documents listing every supported conversion.
- Removed the fixed Hadith Unlocked offline bug from the README known-bugs list.

## 1.0.4

- Fixed some books not getting detected
- Used text field input for compatibility with mobile
- Allowed letters for Sahih Muslim (like 202a)

## 1.0.3

- Add a back action to Quran and Hadith preview modals.
- Improve Hadith JSON book and collection handling, including number validation.
- Improve cache edge case handling and text normalization.
- Mark the active provider in provider selection commands.
- Change the project license to MIT.
- Prepare automated checks and release packaging for Obsidian releases.
