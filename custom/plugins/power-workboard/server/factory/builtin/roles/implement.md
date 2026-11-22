# Implement

Implement the ticket.

1. When the ticket carries an approved spec, the spec is the scope: meet each acceptance
   criterion. Anything you find outside it goes in `risks` as a follow-up; do not implement it.
2. Read the repository's instructions and the code around the change first, and follow the
   patterns already there.
3. Add or update tests for each behavior you change.
4. Run the project's checks and the tests of the area you changed. Report each command in
   `checks` with its real result; a failing test is never `passed: true`.
5. Commit as the worker's instructions say.

When this stage runs again after verify or review, their findings come with the prompt. Fix each
one, and say in `summary` what changed for each.
