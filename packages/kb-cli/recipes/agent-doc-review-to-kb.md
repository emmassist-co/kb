# Agent Document Review To KB Recipe

## Goal

Guide an external agent that has already been asked to read documents and preserve selected durable knowledge in KB.

## When To Use

Use when a human or runtime points an agent at docs, tickets, meeting notes, transcripts, or external research and asks it to decide what should become durable KB state.

## KB Read Commands

```bash
kb-local inspect
kb-local search --json '{"query":"..."}'
kb-local get <existing-id>
kb-local links --id <existing-id>
kb-local schema remember
kb-local schema record
kb-local schema relate
kb-local schema annotate
```

## Agent-Owned Thinking

The agent reads the documents outside KB, extracts meaning, decides what is durable, resolves whether an entity already exists, and chooses the write payloads. KB is the destination and validator, not the document ingester or extractor.

## Safe Write Policy

- Search before creating entities.
- Use `remember` for source-backed notes, durable facts, and corrections.
- Use `record` for canonical entities only when evidence is enough to identify the entity.
- Use `relate` for explicit relationships between existing or newly recorded entities.
- Use `annotate` for timeline/provenance notes on existing entities.
- If evidence is ambiguous, emit a proposal instead of mutating.

## Validation

```bash
kb-local validate remember --json @remember.json
kb-local validate record --json @record.json
kb-local validate relate --json @relation.json
kb-local validate annotate --json @annotation.json
```

## Verification

```bash
kb-local get <id>
kb-local search --json '{"query":"source-backed fact"}'
kb-local query-relations --json '{"query":"relationship question","mode":"graph-first-hybrid"}'
kb-local links --id <id>
```

## Non-Goals

- Do not create a KB-side doc ingestion command.
- Do not dump whole documents when a durable summary, source note, or relation edge is the right artifact.
- Do not let KB decide what matters in the document.
