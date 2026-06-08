# Cloudflare-First Compounding KB

This document describes the intended production shape for `kb`.

## Positioning

`kb` should be easiest to reason about as:

- a compounding knowledge base, not chat memory
- a Cloudflare-first deployed service, not a local-only toolkit
- a tenant-scoped operational brain, not a bag of notes

## Production Shape

The production path should be the default path:

- Worker-hosted `kb-http` surface for reads and writes
- Cloudflare-backed canonical state for tenant knowledge
- explicit per-tenant deployment boundaries
- smoke verification against the deployed host

The local CLI and file store are important, but they support development, migration, and debugging around the production contract.

## Storage Responsibilities

Current package boundaries imply this storage story:

- `kb-core` owns semantics and service orchestration
- `kb-storage-file` owns local file-backed persistence
- `kb-storage-cloudflare` owns Cloudflare-specific state and canonical object storage

That means production durability should bias toward the Cloudflare package first, while keeping the file store as a compatible local mirror.

## Compounding Loop

Every tenant interaction should support the same loop:

1. retrieve the current best knowledge
2. act using that knowledge
3. record new evidence, links, or corrections
4. make the next retrieval better

The system should improve because the loop is structural, not because a prompt says "remember this."

## Design Principles

### Canonical truth beats transcript memory

Useful knowledge should live in explicit KB state, not buried in chat logs.

### Evidence and synthesis stay separate

Compiled truth is allowed, but it must remain traceable back to sources, events, or annotations.

### Tenant isolation is non-negotiable

Per-tenant deployment and storage boundaries are part of the product, not an operational afterthought.

### Verification is part of the product

Benchmarks, smoke tests, and contract checks are how we know the KB is actually compounding.

## Near-Term Documentation Standard

Public docs should keep repeating the same story:

- Cloudflare is the production default
- compounding knowledge is the main value proposition
- local development surfaces exist to support that deployed architecture
- evals and verification are part of the trust model
