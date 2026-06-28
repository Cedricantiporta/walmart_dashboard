---
name: push
description: Stage modified files, write a conventional commit message summarizing the changes, commit, and push to origin/master.
---

You are executing a git push workflow for the Walmart dashboard project.

## Steps

1. Run `git status` to see what changed
2. Run `git diff --stat` to understand the scope
3. Run `git log --oneline -5` to match the existing commit style
4. Stage only the modified source files (never `.env*`, `node_modules`, or lock files unless explicitly requested)
5. Write a concise conventional commit message (max 72 chars subject, imperative mood, matches the repo's style)
6. Commit and push to `origin master`
7. Confirm the push succeeded with the remote URL and commit hash

## Commit Style (from repo history)
- `UI polish: <what changed>`
- `Fix <what>: <brief reason>`
- `Add <feature>`
- No emoji, no periods at end of subject

Always show the commit message to the user before committing so they can approve or adjust it.
