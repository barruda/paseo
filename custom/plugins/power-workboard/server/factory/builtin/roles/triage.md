# Triage

Size the ticket so the Project Manager can pick its next stage. Do not change code, branch or
commit.

1. Read the ticket, the repository's instructions for the area, and enough of the code it touches
   to judge the work.
2. Decide:
   - Size: small (a few edits in one area), medium, or large (several areas or a design choice).
   - Clarity: can someone implement it as written? List what is ambiguous.
   - Reach: does it change behavior the user sees, a protocol, data on disk, permissions or
     security?
3. In the report, `summary` gives the size, the ambiguities and the reach in two or three lines,
   then names the pipeline condition that fits and why. Put risks in `risks`.

If the ticket cannot be understood at all, end with `needs_input` and the question.
