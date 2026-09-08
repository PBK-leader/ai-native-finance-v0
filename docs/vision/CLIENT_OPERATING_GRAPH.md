# Client Operating Graph

> **Implementation note (2026-08-24).** The V0 node/link vocabulary in `docs/decisions/V0_TECHNICAL_DESIGN.md`
> §5.2–§5.3 is the build-level authority: it adds `PROGRESS_SNAPSHOT`, uses `LABOR_AGGREGATE` in place of a
> per-row labor node, and re-points `WORKS_ON` to employee→labor aggregate so unposted labor is drillable.
> Each declared type there names the rule or traversal that consumes it. This document remains the target vocabulary.

## Core idea

Each customer should become a living, structured model of:
1. what exists in the business
2. how those objects relate
3. what agents and humans do
4. what policies govern decisions
5. where every fact came from

The graph is not merely a visual feature. It is the operating context shared by agents, humans, exception rules and applications.

## V0 business objects

- Company
- Division
- Project
- Person
- Employee
- Vendor
- Cost Code
- Budget Line
- Commitment / PO
- Material Receipt
- AP Invoice
- Job Cost Transaction
- Labor Entry
- Change Order
- SOV Item
- Billing
- Forecast Snapshot
- Exception
- Task
- Review Decision
- Agent
- Agent Action

## Example links

- Company `HAS_DIVISION` Division
- Division `HAS_PROJECT` Project
- Project `MANAGED_BY` Person
- Project `HAS_COST_CODE` Cost Code
- Vendor `ISSUES` AP Invoice
- AP Invoice `BELONGS_TO` Project
- AP Invoice `CODED_TO` Cost Code
- AP Invoice `MATCHES` Commitment
- AP Invoice `POSTS_AS` Job Cost Transaction
- Material Receipt `RECEIVED_AGAINST` Commitment
- Employee `WORKS_ON` Project
- Labor Entry `FOR_EMPLOYEE` Employee
- Labor Entry `BELONGS_TO` Project
- Labor Entry `CODED_TO` Cost Code
- Change Order `MODIFIES` Project
- Change Order `MAPS_TO` SOV Item
- Billing `BILLS` SOV Item
- Forecast Snapshot `FORECASTS` Project
- Exception `RELATES_TO` any relevant business object
- Agent `CREATED` Task
- Task `ASSIGNED_TO` Person or Role
- Review Decision `RESOLVES` Task
- Agent Action `TRIGGERED_BY` Task / Decision / Exception

## Source evidence

Every canonical object/link created from client data should retain a source reference such as:
- source system
- source file
- source record ID
- optional field(s) used
- confidence / mapping method where relevant

Do not let an LLM invent graph links without source evidence or an explicit human decision.

## V0 visualization

Include a lightweight Client Operating Graph explorer.

For a selected project:
- show a project-centered subgraph
- allow object-type filters
- click a node to inspect properties
- show source references
- show related exceptions/tasks/decisions
- follow useful relationships such as:
  - Invoice → Commitment → Project → Cost Code
  - Receipt → Commitment → Invoice gap
  - Change Order → Project → SOV → Billing
  - Exception → Task → Review Decision → Recalculation

Do not render the entire client graph at once.

## V0 implementation

Use TypeScript domain objects and explicit link structures.

Do not introduce Neo4j or another graph database in V0.

The same object/link model used for visualization must be used by the reconciliation and agent layers.

## Future evolution

Later the graph can include:
- approval routes
- accounting policies
- materiality thresholds
- branches/entities
- recurring workflow sequences
- learned vendor/PM patterns
- system reliability
- historical resolution patterns
- automation confidence

The long-term goal is a customer-specific operating model that helps agents understand how this particular contractor works.
