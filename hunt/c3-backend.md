# Chunk review: lib/ai.js, lib/scanLine.js, lib/examSummary.js (model: gemini-3.5-flash)

No bugs found in these files.

---

### Risky-but-unconfirmed suspicions

1. **`lib/ai.js:52` — Unhandled `TypeError` if `note` is undefined or non-string**  
   If `scanNote` is invoked with an undefined or null `note` property (e.g. from an empty request payload), `note.split('\n')` will throw an unhandled `TypeError: Cannot read properties of undefined (reading 'split')` before reaching the AI request/validation stage.

2. **`lib/ai.js:145` / `lib/scanLine.js:93` / `lib/examSummary.js:106` — Code fence extraction matching interior
