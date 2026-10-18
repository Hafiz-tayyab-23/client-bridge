import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { badRequest, conflict, notFound } from "../http";
import { audit } from "../audit";
import { requirePerm, type Actor } from "../permissions";

// ───────── Custom fields (F2.2, F2.3) ─────────
export const FIELD_TYPES = ["text", "number", "date", "dropdown", "checkbox"] as const;
export const FieldInput = z
  .object({
    entity: z.enum(["contact", "company", "opportunity"]),
    pipelineId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  })
  .refine((v) => v.type !== "dropdown" || (v.options && v.options.length > 0), { message: "Dropdown needs at least one option.", path: ["options"] })
  .refine((v) => !v.pipelineId || v.entity === "opportunity", { message: "Only opportunity fields can belong to a pipeline.", path: ["pipelineId"] });
export const FieldUpdateInput = z.object({
  label: z.string().trim().min(1).max(80),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});

export interface FieldDef { id: string; entity: string; pipeline_id: string | null; key: string; label: string; type: (typeof FIELD_TYPES)[number]; options: string[]; position: number }

function keyFrom(label: string) {
  const k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
  return /^[a-z]/.test(k) ? k : `f_${k || "field"}`;
}

export async function listFields(actor: Actor, entity?: string) {
  requirePerm(actor, "crm.view");
  return sql<FieldDef[]>`
    select id, entity, pipeline_id, key, label, type, options, position from custom_fields
    where workspace_id = ${actor.workspaceId} ${entity ? sql`and entity = ${entity}` : sql``}
    order by entity, pipeline_id nulls first, position, created_at`;
}

export async function createField(actor: Actor, input: z.infer<typeof FieldInput>) {
  requirePerm(actor, "crm.configure");
  if (input.pipelineId) {
    const [p] = await sql`select 1 from pipelines where id = ${input.pipelineId} and workspace_id = ${actor.workspaceId}`;
    if (!p) throw badRequest("Unknown pipeline.");
  }
  return sql.begin(async (tx) => {
    let key = keyFrom(input.label);
    const taken = new Set((await tx`select key from custom_fields where workspace_id = ${actor.workspaceId} and entity = ${input.entity}`).map((r) => r.key));
    for (let i = 2; taken.has(key); i++) key = `${keyFrom(input.label).slice(0, 33)}_${i}`;
    const [{ pos }] = await tx`select coalesce(max(position), -1) + 1 as pos from custom_fields where workspace_id = ${actor.workspaceId} and entity = ${input.entity}`;
    const [f] = await tx`
      insert into custom_fields (workspace_id, entity, pipeline_id, key, label, type, options, position)
      values (${actor.workspaceId}, ${input.entity}, ${input.pipelineId ?? null}, ${key}, ${input.label}, ${input.type}, ${input.options ?? []}, ${pos})
      returning *`;
    await audit(tx, actor.workspaceId, actor, { event: "field.created", targetType: "custom_field", targetId: f.id, after: { entity: f.entity, label: f.label, type: f.type, pipeline_id: f.pipeline_id, options: f.options } });
    return f;
  });
}

export async function updateField(actor: Actor, id: string, input: z.infer<typeof FieldUpdateInput>) {
  requirePerm(actor, "crm.configure");
  return sql.begin(async (tx) => {
    const [before] = await tx`select * from custom_fields where id = ${id} and workspace_id = ${actor.workspaceId} for update`;
    if (!before) throw notFound("Field not found.");
    if (before.type === "dropdown" && input.options && input.options.length === 0) throw badRequest("Dropdown needs at least one option.");
    const [f] = await tx`update custom_fields set label = ${input.label}, options = ${before.type === "dropdown" ? input.options ?? before.options : before.options} where id = ${id} returning *`;
    await audit(tx, actor.workspaceId, actor, { event: "field.changed", targetType: "custom_field", targetId: id, before: { label: before.label, options: before.options }, after: { label: f.label, options: f.options } });
    return f;
  });
}

/** Deleting a field removes its values from records and from stage requirements (Q4). */
export async function deleteField(actor: Actor, id: string) {
  requirePerm(actor, "crm.configure");
  return sql.begin(async (tx) => {
    const [f] = await tx`select * from custom_fields where id = ${id} and workspace_id = ${actor.workspaceId} for update`;
    if (!f) throw notFound("Field not found.");
    const table = tx(f.entity === "contact" ? "contacts" : f.entity === "company" ? "companies" : "opportunities");
    await tx`update ${table} set custom = custom - ${f.key}::text where workspace_id = ${actor.workspaceId} and custom ? ${f.key}`;
    await tx`delete from custom_fields where id = ${id}`;
    await audit(tx, actor.workspaceId, actor, { event: "field.deleted", targetType: "custom_field", targetId: id, before: { entity: f.entity, label: f.label, type: f.type } });
  });
}

/** Validates and coerces custom values against field definitions; unknown keys are rejected (Q3). */
export function validateCustom(defs: FieldDef[], values: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!values) return out;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(values)) {
    const d = byKey.get(k);
    if (!d) throw badRequest(`Unknown field "${k}".`, [{ path: `custom.${k}`, message: "Unknown field" }]);
    if (v === null || v === "" || v === undefined) { out[k] = null; continue; }
    const err = (m: string) => badRequest(`${d.label}: ${m}`, [{ path: `custom.${k}`, message: m }]);
    switch (d.type) {
      case "text": if (typeof v !== "string" || v.length > 2000) throw err("must be text up to 2000 characters"); out[k] = v.trim(); break;
      case "number": { const n = typeof v === "number" ? v : Number(v); if (!Number.isFinite(n)) throw err("must be a number"); out[k] = n; break; }
      case "date": if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw err("must be a date (YYYY-MM-DD)"); out[k] = v; break;
      case "dropdown": if (typeof v !== "string" || !d.options.includes(v)) throw err(`must be one of: ${d.options.join(", ")}`); out[k] = v; break;
      case "checkbox": if (typeof v !== "boolean") throw err("must be true or false"); out[k] = v; break;
    }
  }
  return out;
}

export async function fieldsFor(workspaceId: string, entity: "contact" | "company" | "opportunity", pipelineId?: string | null) {
  return sql<FieldDef[]>`
    select id, entity, pipeline_id, key, label, type, options, position from custom_fields
    where workspace_id = ${workspaceId} and entity = ${entity}
      and (pipeline_id is null ${pipelineId ? sql`or pipeline_id = ${pipelineId}` : sql``})
    order by position`;
}

// ───────── Pipelines & stages (F2.4, F2.5) ─────────
export const PipelineInput = z.object({ name: z.string().trim().min(1).max(80) });
export const StageInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["open", "won", "lost"]).default("open"),
  requiredFieldIds: z.array(z.string().uuid()).max(50).default([]),
});
export const StageOrderInput = z.object({ stageIds: z.array(z.string().uuid()).min(1).max(100) });
export const StageDeleteInput = z.object({ moveToStageId: z.string().uuid().nullable().optional() });

export async function listPipelines(actor: Actor) {
  requirePerm(actor, "crm.view");
  const [pipelines, stages, req] = await Promise.all([
    sql`select id, name, position from pipelines where workspace_id = ${actor.workspaceId} order by position, created_at`,
    sql`select s.id, s.pipeline_id, s.name, s.position, s.kind,
          (select count(*)::int from opportunities o where o.stage_id = s.id) as opportunity_count
        from stages s where s.workspace_id = ${actor.workspaceId} order by s.position`,
    sql`select r.stage_id, r.field_id from stage_required_fields r join stages s on s.id = r.stage_id where s.workspace_id = ${actor.workspaceId}`,
  ]);
  return pipelines.map((p) => ({
    ...p,
    stages: stages.filter((s) => s.pipeline_id === p.id).map((s) => ({ ...s, required_field_ids: req.filter((r) => r.stage_id === s.id).map((r) => r.field_id) })),
  }));
}

async function loadPipeline(actor: Actor, id: string) {
  const [p] = await sql`select * from pipelines where id = ${id} and workspace_id = ${actor.workspaceId}`;
  if (!p) throw notFound("Pipeline not found.");
  return p;
}

export async function createPipeline(actor: Actor, input: z.infer<typeof PipelineInput>) {
  requirePerm(actor, "crm.configure");
  return sql.begin(async (tx) => {
    const [{ pos }] = await tx`select coalesce(max(position), -1) + 1 as pos from pipelines where workspace_id = ${actor.workspaceId}`;
    const [p] = await tx`insert into pipelines (workspace_id, name, position) values (${actor.workspaceId}, ${input.name}, ${pos}) returning *`;
    for (const [i, [name, kind]] of ([["New", "open"], ["Won", "won"], ["Lost", "lost"]] as const).entries()) {
      await tx`insert into stages (workspace_id, pipeline_id, name, position, kind) values (${actor.workspaceId}, ${p.id}, ${name}, ${i}, ${kind})`;
    }
    await audit(tx, actor.workspaceId, actor, { event: "pipeline.created", targetType: "pipeline", targetId: p.id, after: { name: p.name } });
    return p;
  });
}

export async function renamePipeline(actor: Actor, id: string, input: z.infer<typeof PipelineInput>) {
  requirePerm(actor, "crm.configure");
  const before = await loadPipeline(actor, id);
  return sql.begin(async (tx) => {
    const [p] = await tx`update pipelines set name = ${input.name} where id = ${id} returning *`;
    await audit(tx, actor.workspaceId, actor, { event: "pipeline.renamed", targetType: "pipeline", targetId: id, before: { name: before.name }, after: { name: p.name } });
    return p;
  });
}

async function checkRequiredFields(actor: Actor, pipelineId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await sql`select id from custom_fields where workspace_id = ${actor.workspaceId} and entity = 'opportunity'
    and (pipeline_id is null or pipeline_id = ${pipelineId}) and id = any(${ids}::uuid[])`;
  if (rows.length !== new Set(ids).size) throw badRequest("Required fields must be opportunity fields available in this pipeline.");
}

export async function createStage(actor: Actor, pipelineId: string, input: z.infer<typeof StageInput>) {
  requirePerm(actor, "crm.configure");
  await loadPipeline(actor, pipelineId);
  await checkRequiredFields(actor, pipelineId, input.requiredFieldIds);
  return sql.begin(async (tx) => {
    const [{ pos }] = await tx`select coalesce(max(position), -1) + 1 as pos from stages where pipeline_id = ${pipelineId}`;
    const [s] = await tx`insert into stages (workspace_id, pipeline_id, name, position, kind) values (${actor.workspaceId}, ${pipelineId}, ${input.name}, ${pos}, ${input.kind}) returning *`;
    for (const f of input.requiredFieldIds) await tx`insert into stage_required_fields (stage_id, field_id) values (${s.id}, ${f})`;
    await audit(tx, actor.workspaceId, actor, { event: "stage.created", targetType: "stage", targetId: s.id, after: { name: s.name, kind: s.kind, required: input.requiredFieldIds } });
    return s;
  });
}

export async function updateStage(actor: Actor, stageId: string, input: z.infer<typeof StageInput>) {
  requirePerm(actor, "crm.configure");
  return sql.begin(async (tx) => {
    const [before] = await tx`select * from stages where id = ${stageId} and workspace_id = ${actor.workspaceId} for update`;
    if (!before) throw notFound("Stage not found.");
    await checkRequiredFields(actor, before.pipeline_id, input.requiredFieldIds);
    const beforeReq = (await tx`select field_id from stage_required_fields where stage_id = ${stageId}`).map((r) => r.field_id);
    const [s] = await tx`update stages set name = ${input.name}, kind = ${input.kind} where id = ${stageId} returning *`;
    await tx`delete from stage_required_fields where stage_id = ${stageId}`;
    for (const f of input.requiredFieldIds) await tx`insert into stage_required_fields (stage_id, field_id) values (${stageId}, ${f})`;
    await audit(tx, actor.workspaceId, actor, {
      event: "stage.changed", targetType: "stage", targetId: stageId,
      before: { name: before.name, kind: before.kind, required: beforeReq }, after: { name: s.name, kind: s.kind, required: input.requiredFieldIds },
    });
    return s;
  });
}

export async function reorderStages(actor: Actor, pipelineId: string, input: z.infer<typeof StageOrderInput>) {
  requirePerm(actor, "crm.configure");
  await loadPipeline(actor, pipelineId);
  return sql.begin(async (tx) => {
    const current = await tx`select id, name from stages where pipeline_id = ${pipelineId} order by position for update`;
    const ids = new Set(current.map((s) => s.id));
    if (input.stageIds.length !== ids.size || !input.stageIds.every((id) => ids.has(id))) throw badRequest("Provide every stage of this pipeline exactly once.");
    for (const [i, id] of input.stageIds.entries()) await tx`update stages set position = ${i} where id = ${id}`;
    await audit(tx, actor.workspaceId, actor, { event: "stages.reordered", targetType: "pipeline", targetId: pipelineId, before: current.map((s) => s.id), after: input.stageIds });
  });
}

/** Safe delete (F2.5): a stage with opportunities requires a target stage in the same pipeline. */
export async function deleteStage(actor: Actor, stageId: string, input: z.infer<typeof StageDeleteInput>) {
  requirePerm(actor, "crm.configure");
  return sql.begin(async (tx) => {
    const [s] = await tx`select * from stages where id = ${stageId} and workspace_id = ${actor.workspaceId} for update`;
    if (!s) throw notFound("Stage not found.");
    const [{ n }] = await tx`select count(*)::int as n from stages where pipeline_id = ${s.pipeline_id}`;
    if (n <= 1) throw badRequest("A pipeline needs at least one stage.");
    const [{ opps }] = await tx`select count(*)::int as opps from opportunities where stage_id = ${stageId}`;
    if (opps > 0) {
      if (!input.moveToStageId) throw conflict(`This stage contains ${opps} opportunit${opps === 1 ? "y" : "ies"}. Choose a stage to move them to.`, { opportunities: opps });
      const [target] = await tx`select id from stages where id = ${input.moveToStageId} and pipeline_id = ${s.pipeline_id} and id <> ${stageId}`;
      if (!target) throw badRequest("Target stage must be another stage in the same pipeline.");
      await tx`update opportunities set stage_id = ${target.id}, version = version + 1, updated_at = now() where stage_id = ${stageId}`;
    }
    await tx`delete from stages where id = ${stageId}`;
    await audit(tx, actor.workspaceId, actor, { event: "stage.deleted", targetType: "stage", targetId: stageId, before: { name: s.name, kind: s.kind }, after: { moved_opportunities: opps, to: input.moveToStageId ?? null } });
    return { moved: opps };
  });
}
