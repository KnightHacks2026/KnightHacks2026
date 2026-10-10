import { readVersionedJson } from "@/lib/api/request";
import { serviceNotConnected } from "@/lib/api/envelope";

export async function POST(request: Request) {
  const parsed = await readVersionedJson(request);
  if (!parsed.ok) return parsed.response;
  return serviceNotConnected();
}
