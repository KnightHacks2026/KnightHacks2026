import type { ExampleTwinNode } from "@/contracts";

export type TopologyActivityState = "submitted" | "approved" | "rejected" | "settled" | "flagged" | "simulation";

export interface TopologyActivity {
  id: string;
  type: string;
  state: TopologyActivityState;
  status: string;
  amount?: string;
  time: string;
  source?: string;
  destination?: string;
  nodeIds: readonly [string, string];
  reason?: string;
  timeline: readonly string[];
}

// These scenarios are display fixtures only. Node associations are illustrative,
// and the institutional relationship edges do not establish transfer routes.
export const topologyDemoActivities: readonly TopologyActivity[] = [
  { id: "DEMO-TX-101", type: "Transfer submitted", state: "submitted", status: "Pending review", amount: "1.25 BTC", time: "Demo · 2 min ago", source: "BTC VAULT", destination: "FIREBLOCKS", nodeIds: ["BTC VAULT", "FIREBLOCKS"], timeline: ["Request submitted", "Awaiting human review", "No assets moved"] },
  { id: "DEMO-TX-102", type: "Transfer approved", state: "approved", status: "Authorized, not executed", amount: "4,800 USDC", time: "Demo · 8 min ago", source: "ACME BANK", destination: "SETTLEMENT", nodeIds: ["ACME BANK", "SETTLEMENT"], timeline: ["Request submitted", "Human approval recorded", "Execution and settlement pending"] },
  { id: "DEMO-TX-103", type: "Transfer rejected", state: "rejected", status: "Rejected · no funds moved", amount: "82 ETH", time: "Demo · 14 min ago", source: "ETH VAULT", destination: "FIREBLOCKS", nodeIds: ["ETH VAULT", "FIREBLOCKS"], reason: "Destination evidence requires review", timeline: ["Request submitted", "Policy evidence reviewed", "Request rejected; no funds moved"] },
  { id: "DEMO-TX-104", type: "Transfer settled", state: "settled", status: "Execution and settlement confirmed", amount: "500 USDC", time: "Demo · 21 min ago", source: "ACME BANK", destination: "SETTLEMENT", nodeIds: ["ACME BANK", "SETTLEMENT"], timeline: ["Request submitted", "Human approval recorded", "Execution confirmed", "Settlement confirmed"] },
  { id: "DEMO-POL-105", type: "Policy flagged", state: "flagged", status: "Risk flagged · review needed", amount: "12 BTC", time: "Demo · 29 min ago", source: "BTC VAULT", destination: "POLICY 01", nodeIds: ["BTC VAULT", "POLICY 01"], reason: "Illustrative signer threshold exception", timeline: ["Policy evaluation previewed", "Signer threshold flagged", "Human review needed; no assets moved"] },
  { id: "DEMO-SIM-106", type: "Simulation completed", state: "simulation", status: "Hypothetical projection only", time: "Demo · 36 min ago", source: "ACME BANK", destination: "SETTLEMENT", nodeIds: ["ACME BANK", "SETTLEMENT"], timeline: ["Scenario preview started", "Projection completed", "No operational action taken"] },
];

export function activityNodes(activity: TopologyActivity, nodes: readonly ExampleTwinNode[]): readonly [ExampleTwinNode, ExampleTwinNode] | null {
  const source = nodes.find(node => node.id === activity.nodeIds[0]);
  const destination = nodes.find(node => node.id === activity.nodeIds[1]);
  return source && destination ? [source, destination] : null;
}
