# Custody Twin frontend handoff

This folder and `src/app` / `src/components/ui` are frontend-owned. Shared root configuration is left for Platform.

## Package and styling setup for Platform

- Add Next.js App Router, React, React DOM, TypeScript, Tailwind CSS v4, `@xyflow/react`, `motion`, `lucide-react`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, and `tailwind-merge` to the root package configuration. The workspace imports `@xyflow/react/dist/style.css` and Tailwind from `src/app/globals.css`.
- Include `src/**/*.{ts,tsx}` in Tailwind's source scan. The local shadcn/ui Button, Badge, and Card primitives use Radix Slot, CVA variants, and `cn` composition; add the standard `components.json` when Platform establishes shared CLI configuration.
- Keep strict TypeScript enabled. The frontend uses relative imports and needs no path alias.

## API connection

- The view starts with `cascadeBaselineProjection`, `cascadeSnapshot`, and the two typed request fixtures from `src/contracts/fixtures`. It attempts `GET /api/datasets/dataset-cascade/twin?snapshotId=snapshot-cascade-1` and accepts a projection for the same fixture snapshot and obligation IDs.
- “Run simulation” sends the selected `RunSimulationRequest` to `POST /api/datasets/dataset-cascade/simulations`. It renders a projected comparison only for a matching, valid `RunSimulationResponse`. Invalid results show validation messages; missing APIs leave the baseline fixture intact.
- Before production datasets, connect `GET /api/datasets/:datasetId/workspace` as well, so obligation, account, instrument, and revision details come from the same dataset as `TwinProjection`. The current detail view is intentionally tied to the fixed fixture.
- No correction approval or application action is exposed in this view. Those need an authenticated, audited workflow from Platform.
