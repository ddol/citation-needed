---
name: pr-review
description: >-
  Work a pull request to a clean state: address every review comment, reply in
  each thread with a status (the sha that fixed it, fixing now, or not fixing
  with a reason), and fix red CI (tests, lint, type-check, coverage). Use when
  asked to handle PR comments, respond to reviewers, or get a PR green.
---

# Working a pull request to green

A PR is done when every thread has an answer and CI is green. Every reviewer
comment gets a reply, including the ones being declined: silence reads as
agreement that never arrives. Every reply carries a verifiable status.

## Order of work

1. Read the PR: comments, review threads, CI runs.
2. Fix red CI first. A failing build makes the review comments unreviewable.
3. Address the comments worth addressing.
4. Reply in every thread.
5. Report the state, including what was not fixed.

## Gathering state

Comments arrive on three different endpoints and it is easy to miss a whole
class of them:

```
gh pr view <N> --json title,headRefName,statusCheckRollup,reviews,comments
gh api repos/<owner>/<repo>/pulls/<N>/comments      # inline review comments
gh api repos/<owner>/<repo>/issues/<N>/comments     # top-level PR comments
```

Inline comments are the ones with `path` and `line`. Their thread replies go to
`pulls/<N>/comments/<comment-id>/replies`, never to the issues endpoint.

For CI, get the failing job's log rather than the summary:

```
gh run list --branch <branch> --limit 5
gh run view <run-id> --log-failed
```

## Judging each comment

Reviewer comments are input, not instructions. A bot comment is a hypothesis;
verify it against the code before acting. Three outcomes, all legitimate:

- **Fix it.** The comment is right, or right enough that the code is clearer
  after.
- **Fix the underlying thing instead.** The comment names a symptom. Say so in
  the reply, and describe what was changed instead.
- **Decline.** The comment is wrong, or the change costs more than it returns.
  Say why in the thread. Never close a thread silently.

Reproduce before you fix. A bug you cannot demonstrate is a bug you cannot
verify you fixed, and a reply asserting a fix you did not confirm is worse than
no reply.

When a fix makes an existing test fail, decide which of the two is wrong before
touching either. A test that encodes the bug is the thing to change, and the
reply must disclose that you changed a test rather than only adding one.

## Finding the sha for a reply

Never guess a sha, and never reuse one from earlier in the session: other
tooling may have committed the work under a different sha than expected. Read
it from git at reply time:

```
git log --oneline -1 -- <path-that-changed>
git log --oneline -S '<distinctive string from the fix>' -1
```

If several commits carry the fix, name the range or the branch instead of
picking one arbitrarily. If the fix is uncommitted, say uncommitted.

## Reply format

One reply per thread, in that thread. Lead with the status, then the substance:

```
Fixed in `<sha>`.            # committed and pushed
Fixed in `<sha>` (not yet pushed).
Fixing now.                  # in progress this session
Not fixing: <reason>.        # declined, with the reason
```

After the status line: what changed, why, and what test now covers it. Quote the
code where a snippet is clearer than a sentence. Keep it to the point the
reviewer raised; a thread is not the place to summarise the PR.

Reply bodies go through a file, because shell quoting mangles backticks and
newlines:

```
gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies -F body=@reply.md
```

Accuracy in the status line is the whole point. Claiming pushed when the commit
is local, or naming a sha that does not contain the change, makes every future
reply worthless.

## CI

Fix the cause, not the symptom. A test that fails only in CI is usually an
environment difference (`CI=true`, no TTY, a different timezone, parallel
workers sharing a path), and it should be reproduced locally with that
difference applied before touching the test.

Before replying that CI is fixed, run the same gates CI runs:

```
npm test          # includes the pretest type-check
npx eslint src test --ext .ts,.tsx
npx prettier --check "src/**/*.{ts,tsx}" "test/**/*.{ts,tsx}" "**/*.md"
npx jest --coverage
```

Coverage is a ratchet. If a change drops it below the floor, add the missing
test rather than lowering the threshold.

## Pushing

**Never push without explicit permission.** Ask, and until the answer comes,
say "not yet pushed" in every reply that names a sha. Pushing is outward-facing:
it retriggers CI, notifies reviewers, and cannot be taken back.

The same applies to anything else that leaves the machine: approving, merging,
closing, or converting a PR, and posting a top-level comment when a thread
reply would do.

## Reporting back

State the counts, then anything the reader would want to have been asked about:

- Threads replied to, and how many were fixed, declined, or deferred.
- CI status, with the numbers from the run rather than an adjective.
- Judgment calls made: a test changed rather than added, a comment declined, a
  fix that went wider than the comment asked.
- What is still unpushed.
