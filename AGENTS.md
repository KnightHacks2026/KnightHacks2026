# CustodyOS — Shared Agent Instructions

## Mission
Build CustodyOS, an institutional custody operations platform for the KnightHacks BNY challenge.

The signature innovation is an interactive custody digital twin that simulates cascading settlement failures and compares corrective interventions.

## Architecture
- Next.js with TypeScript
- Tailwind CSS and shadcn/ui
- Motion for React
- React Flow / XYFlow
- Prisma with SQLite for local development
- Vitest and Playwright
- One shared financial data model

## Core Modules
1. ClearFlow: Transaction reconciliation
2. SettleGuard: Settlement risk monitoring
3. LiquidityOS: Cash forecasting
4. OnboardIQ: Institutional onboarding
5. OpsPilot: AI-assisted exception management
6. Custody Twin: Dependency graph and what-if simulation

## Engineering Rules
- Use strict TypeScript.
- Financial calculations must be deterministic and testable.
- Never fabricate financial outcomes.
- Never allocate the same cash or securities inventory twice.
- AI must not directly execute financial actions.
- Simulated corrections require explicit human approval.
- Every approved correction must create an audit record.
- All modules must use shared financial entities and API contracts.
- No disconnected dashboards or decorative-only functionality.
- Prioritize reliable end-to-end workflows.
- Build exceptional frontend experiences without sacrificing correctness.

## Agent Collaboration
- The Chief Architect owns architecture and shared contracts.
- Agents must respect assigned file ownership.
- Avoid modifying another agent's files without coordination.
- Implement against shared interfaces.
- Run relevant tests before reporting completion.
- Report assumptions, limitations, and unresolved issues.
- Never merge into main automatically.

## Hackathon Rules
Before the official hacking period, work only on agent configurations, reusable skills, architecture documentation, and permitted preparation.

Do not implement the competition application before the authorized start.
