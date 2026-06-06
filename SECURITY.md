# Security Policy

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose user data,
execute remote code, bypass extension permissions, or compromise the local
model cache.

Report the issue privately to the repository maintainer through GitHub's
private vulnerability reporting feature when it is available. Include:

- Affected version and browser version
- Reproduction steps
- Security impact
- Relevant extension console output
- A proposed mitigation, if known

Please avoid including real question screenshots or other sensitive user data.

## Security principles

- No external AI inference API is used.
- No API keys are stored.
- Executable extension code is bundled locally.
- Model weights are downloaded only after explicit user consent.
- The extension does not implement authentication, analytics, history, or a
  backend.
- Extension signing keys and browser profile data must never be committed.
