# GitHub Restoration Operational Note

## Status

- Operational note only.
- GitHub access restored.
- No workflow migration authorized.
- No mirroring authorized.
- No Vercel deployment-source change authorized.
- GitLab remains the active source of truth.
- DEGEN remains planning-only.
- Mainnet remains NO-GO.
- Activation not authorized.

## Purpose

This note records the restoration of GitHub access for operational awareness. It confirms that no immediate repo, remote, deployment, or workflow change is required.

## Background

- GitHub account access was restored on October 15, 2026 after GitHub Support lifted restrictions.
- During the restriction period, the project established a working GitLab-based workflow.
- GitLab-backed Vercel deployment is already working.
- Current DEGEN planning work is already being committed and pushed through GitLab.
- Restoration of GitHub access does not require reversing the workflow.

## Current Workflow Decision

- GitLab remains the active source of truth.
- Branch `v3-frontend-sepolia-test` remains the active branch.
- Vercel remains connected to the GitLab workflow.
- GitHub is restored but inactive/standby for this project.
- No remote changes are required now.
- No migration is required now.
- No mirroring is required now.

## Explicit Non-Approvals

- [ ] GitHub migration is not approved.
- [ ] GitHub mirroring is not approved.
- [ ] Changing Vercel deployment source is not approved.
- [ ] Changing active repo source of truth is not approved.
- [ ] Rewriting branch history is not approved.
- [ ] Force-pushing or replacing remotes is not approved.
- [ ] Changing env/config/deploy settings is not approved.
- [ ] Mainnet activation is not approved.

## Future GitHub Use Requirements

- [ ] Owner must approve any future GitHub migration or mirroring.
- [ ] Migration/mirroring must have a separate written plan.
- [ ] Remote names and push direction must be documented before changes.
- [ ] Vercel deployment-source changes must be reviewed separately.
- [ ] GitLab and GitHub branch sync behavior must be planned before enabling.
- [ ] Secrets/env values must not be copied into GitHub.
- [ ] Mainnet status must remain separate from repository migration decisions.

## Relationship To DEGEN Work

- DEGEN planning continues on GitLab.
- GitHub restoration does not approve DEGEN implementation.
- GitHub restoration does not approve DEGEN validation.
- GitHub restoration does not approve DEGEN deployment.
- GitHub restoration does not approve DEGEN activation.
- DEGEN owner approval gates remain authoritative for future phases.

## Non-Goals

- Do not migrate to GitHub now.
- Do not mirror to GitHub now.
- Do not change Vercel source now.
- Do not change remotes now.
- Do not change env/config now.
- Do not deploy now.
- Do not run validation now.
- Do not reopen completed TYSM validation.
- Do not authorize mainnet work.

## Current Decision

- This note does not approve migration.
- This note does not approve mirroring.
- This note does not approve deployment-source changes.
- This note does not approve implementation.
- This note does not approve validation.
- This note does not approve deployment.
- This note does not approve activation.
- GitLab remains the active source of truth.
- GitHub remains restored but inactive/standby for this project.
- DEGEN remains planning-only.
- Mainnet remains NO-GO.
