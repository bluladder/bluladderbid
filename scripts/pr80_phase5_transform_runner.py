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

# Generic disagreement such as “No, that is not right” must consume the one
# clarification prompt; it must not be misclassified as a street correction.
controller = Path("supabase/functions/_shared/workflow/workflowController.ts")
controller_source = controller.read_text()
old_classifier = '''  if (/\\bstreet|road|drive|lane|avenue|boulevard\\b|\\bnot\\b/i.test(text)) {
    return "street";
  }'''
new_classifier = '''  if (/\\b(?:street|road|drive|lane|avenue|boulevard)\\b/i.test(text)) {
    return "street";
  }'''
if controller_source.count(old_classifier) != 1:
    raise SystemExit("Unable to narrow generic address disagreement classification")
controller_source = controller_source.replace(old_classifier, new_classifier, 1)

# The address-manual-review terminal must be durable even if a future helper
# changes how lastStep is carried through mergeFields. Pin the persisted patch
# explicitly after capture rather than relying on an implicit object property.
old_terminal = '''    capture(
      { ...next, quoteStatus: session.quoteStatus, bookingReady: false },
      "manual_review:address_uncertain",
    );
    return {'''
new_terminal = '''    capture(
      { ...next, quoteStatus: session.quoteStatus, bookingReady: false },
      "manual_review:address_uncertain",
    );
    sessionPatch.last_step = "manual_review:address_uncertain";
    sessionPatch.quote_status = session.quoteStatus;
    sessionPatch.booking_ready = false;
    return {'''
if controller_source.count(old_terminal) != 1:
    raise SystemExit("Unable to pin durable address manual-review terminal")
controller.write_text(controller_source.replace(old_terminal, new_terminal, 1))

# Prove the returned patch itself is terminal before the in-memory persistence
# seam runs. This prevents a fake-database quirk from hiding a controller-state
# regression and makes the intended write boundary explicit.
test_file = Path(
    "supabase/functions/_shared/workflow/workflowController_rollout_test.ts"
)
test_source = test_file.read_text()
test_start = test_source.find(
    'Deno.test("phase5 address uncertainty allows one clarification then preserves quote for manual review"'
)
if test_start < 0:
    raise SystemExit("Unable to find Phase 5 address uncertainty test")
needle = "      row = await persistAndReload(sb, second);"
needle_index = test_source.find(needle, test_start)
if needle_index < 0:
    raise SystemExit("Unable to find Phase 5 second-turn persistence boundary")
insertion = (
    '      assertEquals(second.sessionPatch.last_step, '
    '"manual_review:address_uncertain");\n'
    '      assertEquals(second.sessionPatch.quote_status, "firm");\n'
)
test_source = (
    test_source[:needle_index]
    + insertion
    + test_source[needle_index:]
)
test_file.write_text(test_source)
