# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting form:

<https://github.com/liangl1985/work-personal-secretary/security/advisories/new>

Do not include credentials, npm tokens, recovery codes, private prompts, session logs, or user data in a public issue.

Please include:

- affected version and DSH version;
- operating system;
- minimal reproduction steps;
- expected and observed behavior;
- impact assessment;
- any suggested remediation.

## Security boundaries

- Plugins run with the user's local permissions; DSH tool approval does not sandbox plugin code.
- Prompt enhancement is user-triggered and does not log complete prompts.
- Panel snapshot reads do not scan session history.
- Published packages exclude local production sources, ZIP files, generation videos, and QA records.
- Resource and manifest paths are validated and executable content is rejected.
- Skin packs are read from `~/.dsh/data/workspace-tokenpet/skins/`; pack ids and pack-relative file names are validated against path traversal before any file is served.
