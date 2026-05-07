export type TriggerMode = "OPTION" | "OPTION_ID" | "OPTION_SEMANTIC" | "SCORE_LTE" | "SCORE_GTE" | "ALWAYS" | "SELECTOR_OPTION" | "SELECTOR_SEMANTIC";

export interface QuestionFlowTrigger {
  id: number;
  flowConfigId: number;
  delegateCargoId: number;
  triggerMode: string;
  triggerOptionId: number | null;
  triggerSemanticKey?: string | null;
  triggerScore: number | null;
  triggerSelectorId?: number | null;
  triggerSelectorOptionId?: number | null;
  triggerSelectorSemanticKey?: string | null;
  secondFileType: string;
  secondFileMaxFiles: number;
  secondFileLabel: string;
}

export interface AnswerForTrigger {
  optionId: number | null;
  optionIds?: number[];
  awardedScore: number | null;
  optionSemanticKey?: string | null;
  selectorResponses?: { [selectorId: number]: number[] };
  selectorSemanticKeys?: { [selectorId: number]: string[] };
}

export function matchesTrigger(
  trigger: QuestionFlowTrigger,
  answer: AnswerForTrigger
): boolean {
  switch (trigger.triggerMode) {
    case "ALWAYS":
      return true;
    case "OPTION":
    case "OPTION_ID":
      return answer.optionId === trigger.triggerOptionId || 
             (Array.isArray(answer.optionIds) && answer.optionIds.includes(trigger.triggerOptionId!));
    case "OPTION_SEMANTIC":
      return answer.optionSemanticKey != null && answer.optionSemanticKey === trigger.triggerSemanticKey;
    case "SCORE_LTE":
      return (
        answer.awardedScore != null &&
        trigger.triggerScore != null &&
        answer.awardedScore <= trigger.triggerScore
      );
    case "SCORE_GTE":
      return (
        answer.awardedScore != null &&
        trigger.triggerScore != null &&
        answer.awardedScore >= trigger.triggerScore
      );
    case "SELECTOR_OPTION":
      if (!trigger.triggerSelectorId || !trigger.triggerSelectorOptionId) return false;
      const selectorOpts = answer.selectorResponses?.[trigger.triggerSelectorId];
      return Array.isArray(selectorOpts) && selectorOpts.includes(trigger.triggerSelectorOptionId);
    case "SELECTOR_SEMANTIC":
      if (!trigger.triggerSelectorId || !trigger.triggerSelectorSemanticKey) return false;
      const keys = answer.selectorSemanticKeys?.[trigger.triggerSelectorId] ?? [];
      return keys.includes(trigger.triggerSelectorSemanticKey);
    default:
      return false;
  }
}

export function findFiredTrigger(
  triggers: QuestionFlowTrigger[],
  answer: AnswerForTrigger
): QuestionFlowTrigger | null {
  return triggers.find((t) => matchesTrigger(t, answer)) || null;
}

export function validateTriggerMode(
  mode: string,
  trigger: { triggerOptionId: number | null; triggerSemanticKey?: string | null; triggerScore: number | null; triggerSelectorId?: number | null; triggerSelectorOptionId?: number | null; triggerSelectorSemanticKey?: string | null },
  hasOptions: boolean
): string | null {
  switch (mode) {
    case "ALWAYS":
      if (hasOptions) return "ALWAYS no puede combinarse con triggers OPTION";
      break;
    case "OPTION_ID":
    case "OPTION":
      if (!trigger.triggerOptionId) return "OPTION_ID requiere triggerOptionId";
      break;
    case "OPTION_SEMANTIC":
      if (!trigger.triggerSemanticKey) return "OPTION_SEMANTIC requiere triggerSemanticKey";
      break;
    case "SCORE_LTE":
    case "SCORE_GTE":
      if (trigger.triggerScore == null) return `${mode} requiere triggerScore`;
      break;
    case "SELECTOR_OPTION":
      if (!trigger.triggerSelectorId) return "SELECTOR_OPTION requiere triggerSelectorId";
      if (!trigger.triggerSelectorOptionId) return "SELECTOR_OPTION requiere triggerSelectorOptionId";
      break;
    case "SELECTOR_SEMANTIC":
      if (!trigger.triggerSelectorId) return "SELECTOR_SEMANTIC requiere triggerSelectorId";
      if (!trigger.triggerSelectorSemanticKey) return "SELECTOR_SEMANTIC requiere triggerSelectorSemanticKey";
      break;
    default:
      return `Modo inválido: ${mode}`;
  }
  return null;
}