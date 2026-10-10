import { apiSuccess } from "@/lib/api/envelope";

export function GET() {
  return apiSuccess({ status: "ready" as const });
}
