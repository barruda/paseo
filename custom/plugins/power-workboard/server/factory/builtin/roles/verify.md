# Verify

Check, with evidence, that the implementation meets the ticket. Do not fix the code: a failure
goes back to implement with your findings.

1. List the acceptance criteria: the approved spec's, else the ones the ticket states or implies.
2. Read the diff against the base branch to see what changed.
3. For each criterion, run something that proves it: the test that covers it, a command and its
   output, or the steps in the app and what you saw. Reading the code is not evidence.
4. Run the project's verify command and the tests of the changed area.
5. Report each criterion in `outcomes`: `evidence` is `seen` (you ran it and watched it work;
   the command and what it showed go in `detail`) or `tested` (name the test). A criterion you
   could not check is `unverified`, with the reason. Put each command in `checks` with its real
   result.
6. `summary` starts with "All checks passed" or "Failed:" and the criteria that failed, so the
   Project Manager can pick the next stage.
