# Benchmark Fixtures

Add anonymized OCR text cases to `questions.json`. Include the language,
subject preset, expected answer text, and a small set of core-concept keywords.

Do not include private screenshots or personal data. Prefer cases that expose
OCR ambiguity, direct-answer behavior, unlabeled options, negation, grammar,
calculation, or jurisdiction-dependent wording.

To compare stored model output, create a JSON file shaped like
`../sample-results.example.json` and run:

```bash
npm run benchmark -- --results path/to/results.json
```
