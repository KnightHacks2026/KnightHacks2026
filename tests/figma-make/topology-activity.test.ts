import { describe, expect, it } from "vitest";
import { exampleData } from "../../src/contracts/example-data";
import { activityNodes, topologyDemoActivities } from "../../src/features/figma-make/topology-activity";

describe("synthetic topology activity", () => {
  it("associates every fixture with two existing graph nodes without changing topology", () => {
    expect(topologyDemoActivities).toHaveLength(6);
    for (const activity of topologyDemoActivities) {
      const pair = activityNodes(activity, exampleData.nodes);
      expect(pair?.map(node => node.id)).toEqual(activity.nodeIds);
    }
    expect(exampleData.nodes).toHaveLength(8);
    expect(exampleData.edges).toHaveLength(9);
  });

  it("keeps authorization, settlement, rejection, and projection semantically distinct", () => {
    const byState = Object.fromEntries(topologyDemoActivities.map(item => [item.state, item]));
    expect(byState.approved.status).toMatch(/not executed/i);
    expect(byState.approved.timeline).toContain("Execution and settlement pending");
    expect(byState.settled.status).toMatch(/settlement confirmed/i);
    expect(byState.rejected.status).toMatch(/no funds moved/i);
    expect(byState.flagged.reason).toBeTruthy();
    expect(byState.simulation.status).toMatch(/Hypothetical/);
    expect(byState.simulation.amount).toBeUndefined();
  });
});
