"use client";

import { memo, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ArrowUpRight, CircleCheck, CirclePause, Clock3 } from "lucide-react";
import type { Obligation, ProjectedObligation, TwinProjection } from "../../contracts";
import { Badge } from "../../components/ui/badge";
import { formatAssetUnits, formatUtc } from "./format";

type ObligationNode = Node<{
  obligation: Obligation;
  projected: ProjectedObligation;
  from: string;
  to: string;
  selected: boolean;
  depth: number;
}, "obligation">;

const statusTone = {
  blocked: "danger", at_risk: "warning", pending: "neutral",
  settled: "success", cancelled: "neutral",
} as const;

const StatusIcon = {
  blocked: CirclePause, at_risk: Clock3, pending: Clock3,
  settled: CircleCheck, cancelled: CirclePause,
};

const ObligationCard = memo(function ObligationCard({ data }: NodeProps<ObligationNode>) {
  const Icon = StatusIcon[data.projected.status];
  return (
    <div className={`flow-obligation flow-obligation--${data.projected.status} ${data.selected ? "is-selected" : ""}`}>
      {data.projected.status === "blocked" && <span className="flow-obligation__cascade" style={{ animationDelay: `${data.depth * 0.45}s` }} />}
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="flow-obligation__top">
        <span className="flow-obligation__eyebrow">{data.obligation.externalId.toUpperCase()}</span>
        <Badge tone={statusTone[data.projected.status]}><Icon size={12} />{data.projected.status.replace("_", " ")}</Badge>
      </div>
      <div className="flow-obligation__amount">{formatAssetUnits(data.obligation.asset, data.obligation.requiredUnits)}</div>
      <div className="flow-obligation__route"><span>{data.from}</span><ArrowUpRight size={14} /><span>{data.to}</span></div>
      <div className="flow-obligation__bottom"><span>Due {formatUtc(data.obligation.dueAt)}</span><span>↗</span></div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
});

const nodeTypes = { obligation: ObligationCard };

interface SettlementGraphProps {
  projection: TwinProjection;
  obligations: Obligation[];
  accountNames: Record<string, string>;
  selectedId: string;
  onSelect: (id: string) => void;
}

export function SettlementGraph({ projection, obligations, accountNames, selectedId, onSelect }: SettlementGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const byId = new Map(obligations.map((item) => [item.id, item]));
    const projected = new Map(projection.obligations.map((item) => [item.obligationId, item]));
    const order = new Map<string, number>();
    const indegree = new Map(obligations.map((item) => [item.id, 0]));
    projection.dependencies.forEach((dep) => indegree.set(dep.successorObligationId, (indegree.get(dep.successorObligationId) ?? 0) + 1));
    const queue = obligations.filter((item) => indegree.get(item.id) === 0).map((item) => item.id);
    while (queue.length) {
      const id = queue.shift()!;
      const depth = order.get(id) ?? 0;
      projection.dependencies.filter((dep) => dep.predecessorObligationId === id).forEach((dep) => {
        order.set(dep.successorObligationId, Math.max(order.get(dep.successorObligationId) ?? 0, depth + 1));
        indegree.set(dep.successorObligationId, (indegree.get(dep.successorObligationId) ?? 1) - 1);
        if (indegree.get(dep.successorObligationId) === 0) queue.push(dep.successorObligationId);
      });
    }
    const rows = new Map<number, number>();
    const graphNodes: ObligationNode[] = projection.obligations.flatMap((item) => {
      const obligation = byId.get(item.obligationId);
      if (!obligation) return [];
      const depth = order.get(item.obligationId) ?? 0;
      const row = rows.get(depth) ?? 0;
      rows.set(depth, row + 1);
      return [{
        id: obligation.id, type: "obligation" as const,
        position: { x: depth * 350 + 40, y: row * 230 + 60 },
        data: {
          obligation, projected: item,
          from: accountNames[obligation.fromAccountId] ?? obligation.fromAccountId,
          to: accountNames[obligation.toAccountId] ?? obligation.toAccountId,
          selected: selectedId === obligation.id,
          depth,
        },
      }];
    });
    const graphEdges: Edge[] = projection.dependencies.map((dep) => ({
      id: dep.id, source: dep.predecessorObligationId, target: dep.successorObligationId,
      type: "smoothstep", animated: true,
      label: dep.kind.replaceAll("_", " "),
      className: "flow-edge",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#ec735f" },
      style: { stroke: "#ec735f", strokeWidth: 2 },
    }));
    return { nodes: graphNodes, edges: graphEdges };
  }, [accountNames, obligations, projection, selectedId]);

  return (
    <div className="settlement-graph" role="region" aria-label="Settlement dependency graph">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable
        fitView fitViewOptions={{ padding: 0.16 }} minZoom={0.35} maxZoom={1.35}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#deded9" gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
