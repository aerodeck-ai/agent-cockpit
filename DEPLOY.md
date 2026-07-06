# DEPLOY.md

Estate-map rule 5/6 (`~/work/infra/ESTATE-MAP-CANONICAL-20260701.md`) — every deployable repo
declares its real deploy surface here. No DEPLOY.md → not a real deploy.

This repo is a **vendored** mirror (estate map §3: `hermes-agent / agent-cockpit / deer-flow` —
owner Henry, "vendored") of the upstream open-source `outsourc-e/hermes-workspace` project,
kept zero-fork per its own README. There is no shared, Aerodeck-hosted "prod" instance of this
UI today — it's a self-hosted client tool; anyone who wants a running copy pulls the published
image and runs it themselves (Docker Compose / Coolify / Easypanel / Dokploy, per the README's
own Quick Start).

| Field | Value |
|---|---|
| **Target(s)** | None hosted by this estate. The build publishes a self-hostable container image; whoever runs it (Henry, Mally, or an external self-hoster) does so on their own machine/host of choice. |
| **Runner** | `.github/workflows/{ci,docker-publish,evals,security}.yml` — all currently `ubuntu-latest` (hosted; a separate `/system/code` hosted-Actions defect on this repo, tracked by its own card, not fixed here). |
| **Trigger** | `docker-publish.yml`: push to `main` (tags `latest`/`main`/`main-<sha>`), a `v*` git tag (semver tags), or `workflow_dispatch`. |
| **Who can deploy** | N/A as a shared service — there is no prod gate to hold. Repo push access (vendored owner: Henry) controls what lands in `main` and therefore what the next image build publishes. |
| **Artifact** | Multi-arch (`linux/amd64`,`linux/arm64`) Docker image, `ghcr.io/aerodeck-ai/agent-cockpit`, tag shape `latest` / `main` / `main-<sha>` / semver on release tags. |
| **Registry ID** | connection-registry: `agent-cockpit` (repo only, vendored) — no deploy-target row; no shared hosted instance exists on this estate to register. |
