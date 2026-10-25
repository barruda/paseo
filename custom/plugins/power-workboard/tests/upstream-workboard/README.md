# Upstream Workboard tests (not run)

These suites come from `fxbing/workboard` 0.2.0. They assume behavior Power Workboard changed on
purpose: every Paseo workspace imported as a task, an Inbox group, and the `todo`/`task:*` default
groups. They are kept for reference when porting fixes from the Workboard plugin and are excluded
from `vitest run` and the typecheck. The Power Workboard behavior is covered in `tests/power-workboard.test.ts`.
