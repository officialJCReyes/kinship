# Security policy

## Supported versions

Only **the latest release** is supported. Bug fixes and security fixes ship as a new patch release of the newest version; older versions are not patched. The project is pre-alpha and has no release yet.

## Reporting a vulnerability

Please report vulnerabilities **privately**, not in a public issue, discussion or pull request.

Use GitHub's private vulnerability reporting: open <https://github.com/officialJCReyes/kinship/security/advisories/new> (the "Report a vulnerability" button on the repository's Security tab).

Helpful details: the KinShip version, what you did, what you expected and what happened, and whether any private data (health records, DNA results, files) could be exposed. Please do not include real family data in a report.

KinShip has one maintainer, so replies are best effort. Reports are acknowledged, fixed in a patch release of the latest version and credited if you wish.

## What counts

Anything that lets someone read or change data they should not be able to, including medical records and DNA results (these are protected by per-person sharing and by database row-level security), bypass sign-in or roles, read stored files without the file key, or run code on the server.

## Health data

KinShip stores family health history that is private to each person until they share it with specific people. Privacy is enforced in the database as well as in the application. Reports of a way around it are treated as the highest priority.
