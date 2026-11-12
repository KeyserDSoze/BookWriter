import { TASK_KINDS, type AppSettings, type BookProject, type EndpointProfile,
  type TaskKind, type TaskReasoning, type TaskReasoningOverrides } from "./types";

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
  endpoint:EndpointProfile,
):TaskReasoning|undefined{
  // Validate every override, not just selected key: imported or stale settings
  // may contain hostile extra keys and must fail before network/decryption.
  validateTaskReasoningOverrides(settings.taskReasoningEfforts);
  validateTaskReasoningOverrides(book.taskReasoningEfforts);
  const chosen=book.taskReasoningEfforts?.[kind]??settings.taskReasoningEfforts?.[kind];
  if(chosen!==undefined)return validateTaskReasoning(chosen);
  return endpoint.reasoningEffort;
}
export function effectiveReasoningEffort(
  kind:TaskKind, settings:AppSettings,book:BookProject,endpoint:EndpointProfile,
):Exclude<TaskReasoning,"automatic">|undefined {
  const value=taskReasoningChoice(kind,settings,book,endpoint);
  return value==="automatic"?undefined:value;
}
