---
name: Package installs in pnpm workspaces
description: Workaround when the generic package installer targets the monorepo root instead of an artifact package.
---

In this pnpm monorepo, the generic Node package installer can run `pnpm add` at the workspace root and fail with `ERR_PNPM_ADDING_TO_ROOT`.

**Why:** Artifact runtime dependencies belong to their workspace package; root dependencies are not implicitly available to leaf packages.

**How to apply:** Add a dependency with `pnpm --filter @workspace/<slug> add <package>`, then verify it is linked from that package and restart its managed workflow.