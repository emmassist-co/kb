# Company Knowledge Base In Flue

## Goal

Make KB the durable memory layer for company-scoped agent work:

- one agent gets better over time
- multiple agents contribute to the same tenant truth
- corrections persist across sessions
- deployed behavior is verifiable end to end

This is not generic chat memory. It is part of the runtime contract.

## Core Product Claim

The KB compounds when the runtime follows a disciplined loop:

1. read durable knowledge before acting on tenant-specific facts
2. produce work
3. write back new evidence, corrections, and links
4. verify that later runs can reuse what changed

If any step depends on model goodwill instead of explicit surfaces, the system drifts.

## Architectural Split

Keep the split sharp:

- Flue session state:
  - current conversation
  - active task state
  - pending confirmations
  - temporary working notes
- KB state:
  - durable company facts
  - durable process knowledge
  - people, vendors, projects, policies, and decisions
  - evidence and corrections that must survive sessions

Do not let session persistence become the knowledge base.

## Knowledge Model

### 1. Canonical entities

Durable markdown or document-backed records for:

- people
- companies and vendors
- projects
- systems
- processes
- policies and recurring concepts

Each entity should expose:

- stable ID
- tenant scope
- aliases and tags
- current compiled truth
- explicit source or evidence trail

### 2. Events and sources

Append-friendly records of what happened and where it came from:

- incoming requests
- operator notes
- user corrections
- extracted document facts
- external research notes

These should carry provenance, timestamps, and entity references.

### 3. Links and traversable structure

Knowledge should not stay flat. Links between entities, sources, and events should be queryable so the system can traverse relationships rather than only keyword-match isolated documents.

## Cloudflare-First Runtime Shape

Production should default to Cloudflare:

- `kb-http` as the Worker-hosted JSON contract
- `kb-storage-cloudflare` as the deployment-specific persistence adapter
- canonical tenant state stored in Cloudflare-managed durable storage
- deployed smoke checks against the same `kb-http` contract used locally

Local file-backed flows still matter, but they are portability and development tools. They are not the product center of gravity.

## Why Cloudflare First

- single-tenant deployments stay simple
- the Worker adapter keeps the HTTP contract narrow and reproducible
- Cloudflare storage gives a clear production home for durable tenant state
- deployment shape matches the existing repo direction instead of requiring a second backend story

## Runtime Integration Rules

When KB is wired into Flue or another runtime, the operating rules should be explicit:

- read KB before answering tenant-specific factual questions
- write KB after meaningful new information or user correction
- separate evidence from synthesized truth
- preserve tenant isolation at every layer

These rules belong in runtime surfaces and verification, not only in prose.


## External-Agent Improvement Support

KB can support improvement workflows without becoming the worker that runs them. The boundary is: agents think; KB stores, validates, retrieves, relates, and exposes evidence.

External agents may use packaged skills and recipes to review corrections, stale-looking records, relation coverage, or document-derived evidence. The agent or runtime owns all scheduling, source reading, contradiction judgment, duplicate judgment, proposal construction, human approval, and recipe run state. KB remains the durable substrate for validated writes and inspectable reads.

See [kb-agent-improvement-support.md](./kb-agent-improvement-support.md) for the support matrix and recipe contract.

## Verification Expectations

The harness and eval layer should keep checking:

- read-before-answer behavior
- correction persistence and reuse
- cross-session recall
- multi-agent contribution
- tenant isolation
- deployed `kb-http` health and contract truth

Compounding is only real if it is measurable.
