# Company Knowledge Base In Flue

## Goal

Add a compounding, company-scoped knowledge base to the Flue runtime so:

- one agent can keep getting smarter over time
- multiple agents can contribute to the same tenant knowledge base
- knowledge stays inside the company boundary
- the harness can expose and verify knowledge write and read behavior end to end

This should not be treated as generic chat memory. It is part of the runtime contract.

## Patterns Worth Stealing

### From `gbrain`

- Treat the knowledge base as an operational brain, not "chat with your notes".
- Keep a read-write loop: agent reads before acting, then writes back durable learnings.
- Separate current synthesis from evidence:
  - compiled truth = current best understanding
  - timeline = append-only evidence trail
- Make enrichment automatic on every signal path. If ingestion depends on the model remembering to do it, it will drift.
- Keep the repo or markdown layer human-readable, but back it with structured retrieval.
- Make corrections first-class writes.

### From `gstack`

- Separate persistence layers by job:
  - learnings = durable institutional knowledge
  - timeline = what happened
  - checkpoints = in-progress work state
  - health = quality trend
- Prefer append-only writes where possible.
- Resolve duplicates and freshness at read time instead of making writes fragile.

## What Fits This Repo

The repo philosophy already points in the right direction:

- runtime over prompt theater
- tenant isolation by design
- Flue session primitives for short-horizon state
- harness as the structured execution layer and eval surface

That implies a clean split:

- Flue session store:
  - short-horizon conversational state
  - task state
  - turn continuity
- company knowledge base:
  - durable cross-session knowledge
  - company facts, people, vendors, processes, decisions
  - operational learnings and corrections

Do not overload session persistence to become the knowledge base.

## Recommended Knowledge Model

Use three layers.

### 1. Raw facts/events

Append-only records from real activity:

- emails processed
- meetings summarized
- chat requests
- documents reviewed
- user corrections
- external research notes

Each record should include:

- `tenantId`
- `source`
- `ts`
- `entityRefs`
- `summary`
- `evidence`
- `provenance`

### 2. Durable entity pages

Company-scoped canonical records for:

- people
- companies/vendors/customers
- projects
- processes
- systems
- recurring concepts/policies

Each page should have:

- frontmatter with stable ID, type, tenant, tags, aliases
- compiled truth at the top
- append-only timeline below

This is the `gbrain` pattern that matters most here.

### 3. Retrieval index

Search over the durable layer using hybrid retrieval:

- keyword search for exact names and policy phrases
- semantic search for fuzzy recall
- explicit links between entities when possible

The retrieval layer is not the source of truth. It is the acceleration layer.

## Recommended Storage Shape

For this product stage, keep it simple and single-tenant per deployment.

### Source of truth

Start with tenant-scoped markdown plus a small structured sidecar:

- `/workspace/.kb/entities/*.md`
- `/workspace/.kb/events/*.json`
- `/workspace/.kb/index/*.json`

In local dev and harness runs, this can live in the Flue workspace FS.
In deployed environments, the same logical shape should persist in a durable tenant store, not only process memory.

### Why this shape

- easy for agents to read and write
- easy for humans to inspect
- consistent with the repo's skill-first runtime philosophy
- good enough before adding pgvector or a larger external brain system

## How To Wire It Into Flue

The key is to make KB access a first-class runtime surface, like `gws`.

### Add a `kb` command surface

Expose a runtime command with operations like:

- `kb search --json '{...}'`
- `kb get --id ...`
- `kb remember --json '{...}'`
- `kb record --json '{...}'`
- `kb annotate --json '{...}'`
- `kb related --id ...`

This matches the existing philosophy:

- commands over descriptions
- inspectable
- reproducible
- auditable

### Add KB instructions to runtime context

The generated workspace instructions should hard-code rules like:

- before answering company-specific factual questions, search the KB first
- after meaningful new information or user corrections, write to the KB
- when evidence is weak or conflicting, separate fact from assumption

This rule belongs in runtime-generated context, not only docs.

### Keep Flue sessions for short-term state

Session state should track:

- current conversation
- active task
- pending confirmations
- temporary working notes

The KB should track:

- durable company knowledge
- durable process knowledge
- multi-agent shared understanding

## Harness Changes Needed

The harness should verify KB behavior explicitly, not indirectly.

Add tests/prompts for:

- read before answer:
  - seed a company fact into the KB
  - ask the agent about it
  - verify it used KB retrieval
- write after correction:
  - give a wrong fact, correct it, then ask again
  - verify the correction persisted
- cross-session reuse:
  - write in one session
  - ask in a new session
  - verify recall
- multi-agent contribution:
  - one skill or role writes a note
  - another role retrieves and uses it
- tenant isolation:
  - verify no cross-tenant reads are possible

This is fully aligned with `docs/operations/harness.md`: the harness is the runtime layer that exposes the KB surface and the eval surface that checks routing, policy, and state.

## Minimal Implementation Path

### Phase 1

- add a tenant-scoped `kb` runtime command
- store markdown entity pages plus append-only event JSON
- inject KB operating rules into generated runtime instructions
- add harness checks for KB read/write/correction behavior

### Phase 2

- add hybrid search indexing
- add link extraction between entities
- add automatic enrichment on selected skill paths
  - email triage
  - meeting prep
  - docs ingestion
  - support or ops workflows

### Phase 3

- move backing storage from workspace-only files to durable tenant storage
- add background consolidation jobs
- rewrite compiled truth from accumulated evidence

## Recommended First-Class Page Types

Keep the initial schema narrow:

- `company`
- `person`
- `process`
- `project`
- `policy`
- `vendor`
- `decision`

Do not start with a generic "note" bucket as the primary abstraction. It will rot quickly.

## Design Rule

The knowledge base should be company memory, not agent autobiography.

Good KB entries:

- "Vendor X requires invoices to be emailed to finance@..."
- "Hiring approvals require Alexandre plus department lead approval."
- "Customer Y prefers WhatsApp and invoices on the first business day."

Bad KB entries:

- "The agent tried three commands and one failed."
- "This conversation felt ambiguous."

Those belong in operational traces, not the company brain.

## Bottom Line

Flue is a good place to do this if the knowledge base becomes part of the runtime harness surface:

- `gws` handles actions on external systems
- Flue sessions handle short-term continuity
- a new `kb` surface handles durable shared company knowledge
- the harness verifies the full read/write loop

That keeps the system aligned with the repo philosophy and avoids turning "memory" into a vague prompt-level feature.
