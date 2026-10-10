import type {
  ApplyApprovedCorrectionRequest,
  ApplyApprovedCorrectionResponse,
  CreateCorrectionProposalRequest,
  CreateCorrectionProposalResponse,
  DecideCorrectionProposalRequest,
  DecideCorrectionProposalResponse,
  GetAuditEventsRequest,
  GetAuditEventsResponse,
  GetExplanationRequest,
  GetExplanationResponse,
  GetTwinRequest,
  GetTwinResponse,
  GetWorkspaceRequest,
  GetWorkspaceResponse,
  ImportDatasetRequest,
  ImportDatasetResponse,
  RunReconciliationRequest,
  RunReconciliationResponse,
  RunSimulationRequest,
  RunSimulationResponse,
} from "@/contracts";

/** Route adapter signatures; financial behavior lives in the corresponding owned services. */
export interface ApiOperations {
  importDataset: { request: ImportDatasetRequest; response: ImportDatasetResponse };
  runReconciliation: { request: RunReconciliationRequest; response: RunReconciliationResponse };
  getWorkspace: { request: GetWorkspaceRequest; response: GetWorkspaceResponse };
  getTwin: { request: GetTwinRequest; response: GetTwinResponse };
  runSimulation: { request: RunSimulationRequest; response: RunSimulationResponse };
  getExplanation: { request: GetExplanationRequest; response: GetExplanationResponse };
  createCorrectionProposal: { request: CreateCorrectionProposalRequest; response: CreateCorrectionProposalResponse };
  decideCorrectionProposal: { request: DecideCorrectionProposalRequest; response: DecideCorrectionProposalResponse };
  applyApprovedCorrection: { request: ApplyApprovedCorrectionRequest; response: ApplyApprovedCorrectionResponse };
  getAuditEvents: { request: GetAuditEventsRequest; response: GetAuditEventsResponse };
}

export const apiPaths = {
  importDataset: "/api/datasets/import",
  runReconciliation: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/reconciliation`,
  getWorkspace: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/workspace`,
  getTwin: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/twin`,
  runSimulation: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/simulations`,
  getExplanation: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/explanations`,
  createCorrectionProposal: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/correction-proposals`,
  decideCorrectionProposal: (datasetId: string, proposalId: string) =>
    `/api/datasets/${encodeURIComponent(datasetId)}/correction-proposals/${encodeURIComponent(proposalId)}/decisions`,
  applyApprovedCorrection: (datasetId: string, proposalId: string) =>
    `/api/datasets/${encodeURIComponent(datasetId)}/correction-proposals/${encodeURIComponent(proposalId)}/apply`,
  getAuditEvents: (datasetId: string) => `/api/datasets/${encodeURIComponent(datasetId)}/audit-events`,
} as const;
