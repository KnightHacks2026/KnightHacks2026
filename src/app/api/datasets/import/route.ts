import { readVersionedJson } from "@/lib/api/request";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { DatasetConflictError, getAuthenticatedUser, importDataset } from "@/lib/data/repository";
import { validateImport } from "@/lib/data/validation";

export async function POST(request: Request) {
  const userId = await getAuthenticatedUser(request);
  if (!userId) return apiError("PERMISSION_DENIED", "Sign in before importing a dataset.", 401);
  const parsed = await readVersionedJson(request);
  if (!parsed.ok) return parsed.response;
  const validated = validateImport(parsed.input);
  if (validated.issues.length || !validated.data) return apiError("VALIDATION_FAILED", "Dataset import failed validation.", 422, validated.issues);
  try {
    const data = await importDataset(userId, validated.data);
    return apiSuccess(data, 201, data.dataset.revision);
  } catch (error) {
    if (error instanceof DatasetConflictError) return apiError("REVISION_CONFLICT", error.message, 409);
    throw error;
  }
}
