---
last_updated: 2026-06-07
---

# KB Strategy

## Target Problem

Agents and operator runtimes forget too much, re-learn too often, and mix durable company knowledge with transient chat state. That makes answers brittle, cross-session behavior inconsistent, and corrections expensive because the system keeps paying the same learning cost.

## Our Approach

Build a compounding knowledge base where every meaningful interaction can improve durable tenant knowledge, then make the Cloudflare deployment shape the primary production runtime. `kb` separates:

- canonical knowledge from transient session state
- evidence and corrections from current synthesized truth
- backend-neutral semantics from deployment-specific adapters

The system compounds through explicit reads, explicit writes, append-friendly evidence capture, and repeatable verification of retrieval, provenance, freshness, and correction behavior.

## Who It's For

- teams running single-tenant or tenant-isolated agent deployments
- operators who need an inspectable KB surface, not hidden prompt memory
- product and platform engineers embedding durable knowledge into Flue or adjacent runtimes

## Key Metrics

- percentage of company-specific answers that read KB state before answering
- percentage of meaningful user corrections that persist and are reused cross-session
- deployed `kb-http` verification pass rate
- benchmark quality across retrieval, provenance, temporal freshness, identity, contradiction handling, and fuzzy recall
- time from new evidence to usable durable knowledge

## Tracks

## 1. Cloudflare-First Runtime

Keep the production contract anchored on Worker-hosted `kb-http` plus Cloudflare-native persistence. Local file-backed and daemon modes exist to develop, debug, and mirror the production shape, not to replace it.

## 2. Compounding Knowledge Model

Keep entity pages, sources, links, drafts, and events as first-class state. Make corrections, provenance, and freshness visible in both storage and retrieval instead of burying them in agent transcripts.

## 3. Operational Adoption

Make `kb-cli`, installable skills, and Flue adapters the standard way agents and operators read/write knowledge. Reduce custom per-runtime glue.

## 4. Verification And Trust

Treat benchmark and smoke coverage as part of the product. The KB is only useful if retrieval quality, temporal behavior, and deployed HTTP behavior are measurable and stable.

## Milestones

- lock the repo-level positioning around Cloudflare-first compounding KB
- keep `kb-http` and `kb-storage-cloudflare` as the canonical production path
- expand evals and smoke checks around correction reuse and deployment truth

## Not Working On

- generic multi-tenant control plane complexity before single-tenant deployments hurt
- chat-history-as-memory shortcuts that bypass explicit KB reads and writes
- backend sprawl that weakens the Cloudflare production story without adding clear leverage
