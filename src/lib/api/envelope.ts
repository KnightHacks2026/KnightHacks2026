import { NextResponse } from "next/server";
import { CONTRACT_VERSION, type ApiErrorCode, type ApiResponse, type DecimalInteger, type ValidationIssue } from "@/contracts";

function meta(datasetRevision?: DecimalInteger) {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    ...(datasetRevision === undefined ? {} : { datasetRevision }),
  };
}

export function apiSuccess<T>(data: T, status = 200, datasetRevision?: DecimalInteger) {
  const body: ApiResponse<T> = { ok: true, data, meta: meta(datasetRevision) };
  return NextResponse.json(body, { status });
}

export function apiError<T = never>(
  code: ApiErrorCode,
  message: string,
  status: number,
  validationIssues?: ValidationIssue[],
) {
  const body: ApiResponse<T> = { ok: false, error: { code, message, ...(validationIssues ? { validationIssues } : {}) }, meta: meta() };
  return NextResponse.json(body, { status });
}

/** Temporary route response until an owned service implementation is connected. */
export function serviceNotConnected() {
  return apiError("INTERNAL_ERROR", "This service is not connected yet.", 501);
}
