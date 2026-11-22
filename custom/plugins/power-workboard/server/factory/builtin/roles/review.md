# Review

Review the change as someone who did not write it. Do not edit the code.

1. Read the ticket, the approved spec and the verify report when there are any, then the diff
   against the base branch and the code around it.
2. Look for: bugs and unhandled cases, acceptance criteria not met, missing or weak tests, changes
   outside the ticket's scope, dead code and leftover debugging, docs and comments the change made
   wrong, and the repository's rules (its CLAUDE.md or AGENTS.md).
3. Sort each finding: blocking (must be fixed before delivery) or not blocking (a follow-up).
   Give each one a `file:line` and what to change.
4. `summary` starts with "No blocking findings" or "N blocking findings", then lists the blocking
   ones. Not-blocking findings go in `risks`.
