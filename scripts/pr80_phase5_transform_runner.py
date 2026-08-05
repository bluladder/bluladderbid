#!/usr/bin/env python3
from pathlib import Path

MAIN = Path("scripts/pr80_phase5_transform.py")
source = MAIN.read_text()
old = '''def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one exact occurrence, found {count}: {old[:100]!r}"
        )
    file.write_text(text.replace(old, new, 1))
'''
new = '''def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count == 1:
        file.write_text(text.replace(old, new, 1))
        return

    # The transformer is stored in YAML/contents-API history, where embedded
    # triple-quoted blocks may retain a different common indent. Fall back to
    # one indentation-insensitive contiguous-line match, then shift the new
    # block by the exact first-line indentation delta.
    text_lines = text.splitlines(keepends=True)
    old_lines = old.splitlines()
    old_normalized = [line.lstrip() for line in old_lines]
    matches: list[int] = []
    for index in range(0, len(text_lines) - len(old_lines) + 1):
        candidate = [
            line.rstrip("\\r\\n").lstrip()
            for line in text_lines[index:index + len(old_lines)]
        ]
        if candidate == old_normalized:
            matches.append(index)
    if len(matches) != 1:
        raise SystemExit(
            f"{path}: expected one exact or indentation-insensitive occurrence, "
            f"found exact={count}, normalized={len(matches)}: {old[:100]!r}"
        )

    index = matches[0]
    matched_lines = text_lines[index:index + len(old_lines)]
    matched_first = matched_lines[0].rstrip("\\r\\n")
    new_lines = new.splitlines()
    new_first = next((line for line in new_lines if line.strip()), "")
    matched_indent = len(matched_first) - len(matched_first.lstrip())
    new_indent = len(new_first) - len(new_first.lstrip())
    delta = matched_indent - new_indent

    shifted: list[str] = []
    for line in new_lines:
        if not line.strip():
            shifted.append("")
            continue
        current = len(line) - len(line.lstrip())
        shifted.append(" " * max(0, current + delta) + line.lstrip())
    replacement = "\\n".join(shifted)
    if matched_lines[-1].endswith(("\\n", "\\r")):
        replacement += "\\n"

    start = sum(len(line) for line in text_lines[:index])
    end = start + sum(len(line) for line in matched_lines)
    file.write_text(text[:start] + replacement + text[end:])
'''
if source.count(old) != 1:
    raise SystemExit("Unable to install indentation-tolerant replace_once")
patched = source.replace(old, new, 1)
exec(compile(patched, str(MAIN), "exec"), {"__name__": "__main__"})
