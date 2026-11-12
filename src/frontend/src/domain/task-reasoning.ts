import { TASK_KINDS, type AppSettings, type BookProject, type EndpointProfile,
  type TaskKind, type TaskReasoning, type TaskReasoningOverrides } from "./types";
import { REASONING_LEVELS, reasoningLevelSupported, reasoningSupport } from "./model-reasoning";

const ALLOWED = new Set<TaskReasoning>(["automatic","low","medium","high","xhigh"]);
export function validateTaskReasoning(value: unknown): TaskReasoning {
  if(typeof value !== "string" || !ALLOWED.has(value as TaskReasoning))
    throw new Error("Livello di reasoning del task non valido.");
  return value as TaskReasoning;
}
export function validateTaskReasoningOverrides(value:unknown): void {
  if(value===undefined)return;
  if(!value || typeof value!=="object" || Array.isArray(value))
    throw new Error("Configurazione reasoning dei task non valida.");
  for(const [task,effort] of Object.entries(value)){
    if(!TASK_KINDS.some(x=>x===task))throw new Error("Attività reasoning non riconosciuta.");
    validateTaskReasoning(effort);
  }
}
export function taskReasoningChoice(
  kind:TaskKind,settings:AppSettings,book:BookProject,
  endpoint:EndpointProfile,modelId?:string,
):TaskReasoning|undefined{
  // Validate every override, not just selected key: imported or stale settings
  // may contain hostile extra keys and must fail before network/decryption.
  validateTaskReasoningOverrides(settings.taskReasoningEfforts);
  validateTaskReasoningOverrides(book.taskReasoningEfforts);
  const explicit=book.taskReasoningEfforts?.[kind]??settings.taskReasoningEfforts?.[kind];
  const level:TaskReasoning|undefined=explicit!==undefined?validateTaskReasoning(explicit):endpoint.reasoningEffort;
  if(level===undefined)return undefined;
  // The provider told us this model rejects the level: omit it instead of
  // sending a parameter that would fail or be ignored.
  if(modelId!==undefined && (REASONING_LEVELS as readonly string[]).includes(level) &&
    !reasoningLevelSupported(reasoningSupport(endpoint,modelId),level))
    return "automatic";
  return level;
}
export function effectiveReasoningEffort(
  kind:TaskKind, settings:AppSettings,book:BookProject,endpoint:EndpointProfile,modelId?:string,
):Exclude<TaskReasoning,"automatic">|undefined {
  const value=taskReasoningChoice(kind,settings,book,endpoint,modelId);
  return value==="automatic"?undefined:value;
}
