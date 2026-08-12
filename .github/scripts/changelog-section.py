#!/usr/bin/env python3
"""Print the CHANGELOG.md section for one version, for use as release notes.

Usage: changelog-section.py 0.4.1 [path/to/CHANGELOG.md]

Exits non-zero when the version has no section, so a release cannot be cut with
notes that silently fall back to the wrong entry.
"""

import re
import sys


def extract(changelog: str, version: str) -> str:
    heading = re.compile(r'^## \[([^\]]+)\]')
    lines = changelog.splitlines()

    start = None
    for i, line in enumerate(lines):
        match = heading.match(line)
        if match and match.group(1) == version:
            start = i + 1
            break

    if start is None:
        raise SystemExit(f'no CHANGELOG section for version {version}')

    end = len(lines)
    for i in range(start, len(lines)):
        if heading.match(lines[i]):
            end = i
            break

    body = '\n'.join(lines[start:end]).strip()
    # Trailing '---' separators belong to the file's layout, not the notes.
    body = re.sub(r'\n+---\s*$', '', body).strip()
    return body


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('usage: changelog-section.py <version> [changelog path]')

    version = sys.argv[1]
    path = sys.argv[2] if len(sys.argv) > 2 else 'CHANGELOG.md'

    with open(path, encoding='utf-8') as handle:
        changelog = handle.read()

    print(extract(changelog, version))


if __name__ == '__main__':
    main()
