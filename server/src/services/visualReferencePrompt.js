import { DEFAULT_VISUAL_REFERENCE_PROMPT } from "../models/Settings.js";

const entityTypes = { characters: "персонаж", locations: "локация", objects: "объект" };

function publicEntity(entity) {
  const { id, _id, ...content } = entity?.toObject ? entity.toObject() : entity;
  return content;
}

export function buildVisualReferencePrompt(project, bible, entityCollection, entity, configuredPrompt) {
  const template = typeof configuredPrompt === "string" && configuredPrompt.trim()
    ? configuredPrompt : DEFAULT_VISUAL_REFERENCE_PROMPT;
  const visualStyle = bible?.visualStyle && typeof bible.visualStyle === "object" ? bible.visualStyle : {};
  const continuityRules = Array.isArray(bible?.continuityRules) ? bible.continuityRules : [];
  const prompt = template.split("{{PROJECT_TITLE}}").join(String(project?.title ?? ""))
    .split("{{VISUAL_STYLE}}").join(JSON.stringify(visualStyle))
    .split("{{CONTINUITY_RULES}}").join(JSON.stringify(continuityRules))
    .split("{{ENTITY_TYPE}}").join(entityTypes[entityCollection] ?? "")
    .split("{{ENTITY_NAME}}").join(String(entity?.name ?? ""))
    .split("{{ENTITY_DATA}}").join(JSON.stringify(publicEntity(entity)))
    .trim();
  if (!prompt || prompt.length > 12000) {
    const error = new Error("FLOW_PROMPT_TOO_LONG");
    error.code = "FLOW_PROMPT_TOO_LONG";
    throw error;
  }
  return prompt;
}