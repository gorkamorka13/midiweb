## Approach
- Read existing files before writing. Don't re-read unless changed.
- Concise in output.
- Don't load generated or vendored assets into context (minified bundles, source maps, binaries, image-data headers); search them instead. README.md are large: read the ranges the task needs.
- Open with the answer and end when it is complete.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.