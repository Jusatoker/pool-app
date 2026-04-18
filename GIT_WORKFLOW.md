# Git workflow (solo or team)

The point of this workflow is to make code review a habit, even when you're the only developer. It also matches how you'll work on a team — so when you hire your first engineer, nothing changes.

## The flow

1. **Start from an up-to-date `main`:**
   ```bash
   git checkout main
   git pull
   ```

2. **Create a feature branch:**
   ```bash
   git checkout -b feat/equipment-validation
   ```

3. **Make small, focused commits.** Each commit should be one understandable change. Commit messages are imperative mood:
   - `Add Zod schema for equipment create endpoint`
   - `Wire requireAuth into equipment router`
   - NOT: `stuff` or `wip` or `fixed it`

4. **Push and open a PR:**
   ```bash
   git push -u origin feat/equipment-validation
   gh pr create --fill
   ```

5. **Review your own diff** in the GitHub UI before requesting any other review. Read it as if a stranger wrote it. Ask:
   - Does every change have a reason?
   - Did I leave any `console.log`, commented code, or TODO that should be a real ticket?
   - Did I update tests, docs, and `.env.example` if needed?
   - Does this pass the pre-ship checklist?

6. **Merge** via the GitHub UI (squash by default for tidy history). Delete the branch after merge.

## Branch naming

Format: `<type>/<short-description>`

| Type | When to use |
|---|---|
| `feat/` | New user-facing feature |
| `fix/` | Bug fix |
| `chore/` | Build, deps, tooling |
| `docs/` | Docs only |
| `refactor/` | Code change with no behavior change |
| `test/` | Adding or fixing tests |
| `security/` | Security-impacting change (treat as high-priority review) |

## PR description template

Every PR description answers four questions:

```
## What
<Describe what changed in 1-3 sentences.>

## Why
<Describe the user-facing or technical reason.>

## How to test
<Step-by-step. Include the expected outcome.>

## Follow-ups
<Anything not in this PR but should be tracked. Open issues if applicable.>
```

## Rules of the road

- **Never push to `main`.** Even on a solo project. Use a branch.
- **Never force-push to `main`.** Even by accident.
- **Never `--no-verify`** to skip pre-commit hooks. If a hook is failing, fix the underlying issue.
- **Never commit `.env`.** Check `git status` before every commit.
- **Never commit secrets.** If a secret leaks: rotate it immediately, then deal with the git history.
- **One PR = one logical change.** Don't bundle a refactor with a feature with a dep upgrade. Three small PRs are better than one big one.
- **Big change?** Open it as a `Draft` PR early so you can get feedback before you've written everything.

## When something goes wrong

- Committed to `main` by accident? Move the commits to a branch:
  ```bash
  git branch feat/recover
  git reset --hard origin/main
  git checkout feat/recover
  git push -u origin feat/recover
  ```
  Then open a PR.

- Committed a secret? **Rotate the secret first.** Then remove from history with `git filter-repo` or BFG, force-push, and consider the secret compromised forever (because it is).

- Bad merge? Don't `git push --force` on a shared branch. Open a fix PR.
