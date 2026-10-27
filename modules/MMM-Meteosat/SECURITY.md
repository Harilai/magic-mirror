# Security Policy

## Reporting a Vulnerability

Do not disclose security vulnerabilities in a public issue.

Use GitHub's private vulnerability reporting feature to contact the repository maintainer. Include enough information to reproduce and assess the issue without publishing sensitive local information.

Useful details include:

- affected module version or Git commit,
- MagicMirror² and Node.js versions,
- operating system,
- clear reproduction steps,
- expected and observed behaviour,
- relevant minimal log excerpts.

## Sensitive Information

Before sharing issues, discussions, pull requests, screenshots or logs, remove information that is not required to reproduce the problem, including:

- account passwords and session information,
- complete private MagicMirror² configurations,
- private hostnames, IP addresses and network paths,
- personal information,
- unrelated environment variables and logs.

## Dependency and Input Handling Issues

Security reports are particularly useful when they concern:

- vulnerabilities in runtime dependencies such as `sharp`,
- unsafe file or cache-path handling,
- unexpected handling of WMS responses,
- denial-of-service conditions caused by image size or repeated requests,
- exposure of local files or diagnostic information.

## Supported Versions

Security fixes are applied to the latest released version.
