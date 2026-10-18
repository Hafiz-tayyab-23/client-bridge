import "server-only";
import { badRequest } from "./http";
import { FilterSpec, ListQuery, type Filters } from "./services/records";

/** Parses list filters from a query string; `custom` is a JSON array of {key, op, value}. */
export function parseFilters(sp: URLSearchParams): Filters {
  const raw: Record<string, unknown> = {};
  for (const k of ["q", "tag", "pipelineId", "stageId", "ownerId", "createdFrom", "createdTo"]) {
    const v = sp.get(k);
    if (v) raw[k] = v;
  }
  const c = sp.get("custom");
  if (c) {
    try { raw.custom = JSON.parse(c); } catch { throw badRequest("Invalid custom filter."); }
  }
  return FilterSpec.parse(raw);
}

export function parsePage(sp: URLSearchParams) {
  return ListQuery.parse({ page: sp.get("page") ?? undefined, pageSize: sp.get("pageSize") ?? undefined });
}
