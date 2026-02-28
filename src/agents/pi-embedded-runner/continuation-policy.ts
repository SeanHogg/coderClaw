export type ContinuationPolicyInput = {
  userPrompt: string;
  assistantTexts: string[];
  toolNames: string[];
  aborted?: boolean;
  timedOut?: boolean;
  promptErrored?: boolean;
  hasPendingClientToolCall?: boolean;
};

export type ContinuationPolicyDecision = {
  shouldContinue: boolean;
  reason?: string;
};

const INVESTIGATION_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "git_history",
  "sessions_history",
]);

const EXECUTION_TASK_PATTERN =
  /\b(implement|wire|fix|update|refactor|create|modify|build|patch|test|roadmap|prd|task|phase|start:)\b/i;

const DIRECT_USER_QUESTION_PATTERN =
  /\b(can you|could you|would you|do you want|which|what|where|when|should i|please provide|need your)\b/i;

const COMPLETION_PATTERN =
  /\b(completed|done|finished|implemented|updated|fixed|added|tests?\s+(pass|passed)|all tasks? complete|all set|ready for review)\b/i;

const DEFERRAL_PATTERN =
  /\b(let me|i\s*'ll|i will|next step|going to|check .* first|understand .* first)\b/i;

function normalizeLastAssistantText(assistantTexts: string[]): string {
  for (let i = assistantTexts.length - 1; i >= 0; i -= 1) {
    const text = assistantTexts[i]?.trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function isQuestionForUser(text: string): boolean {
  if (!text || !text.includes("?")) {
    return false;
  }
  return DIRECT_USER_QUESTION_PATTERN.test(text) || /\?\s*$/.test(text);
}

function looksLikeExecutionTask(prompt: string): boolean {
  return EXECUTION_TASK_PATTERN.test(prompt);
}

function isInvestigationOnly(toolNames: string[]): boolean {
  if (toolNames.length === 0) {
    return false;
  }
  return toolNames.every((name) => INVESTIGATION_TOOLS.has(name));
}

export function shouldAutoContinueRun(input: ContinuationPolicyInput): ContinuationPolicyDecision {
  if (input.aborted || input.timedOut || input.promptErrored || input.hasPendingClientToolCall) {
    return { shouldContinue: false };
  }

  if (!looksLikeExecutionTask(input.userPrompt)) {
    return { shouldContinue: false };
  }

  const lastAssistantText = normalizeLastAssistantText(input.assistantTexts);
  if (!lastAssistantText) {
    return { shouldContinue: false };
  }

  if (isQuestionForUser(lastAssistantText)) {
    return { shouldContinue: false, reason: "asked_user_question" };
  }

  if (COMPLETION_PATTERN.test(lastAssistantText)) {
    return { shouldContinue: false, reason: "looks_complete" };
  }

  if (DEFERRAL_PATTERN.test(lastAssistantText)) {
    return { shouldContinue: true, reason: "deferral_language" };
  }

  if (isInvestigationOnly(input.toolNames)) {
    return { shouldContinue: true, reason: "investigation_only_tools" };
  }

  return { shouldContinue: false };
}

export const AUTO_CONTINUE_PROMPT =
  "Continue executing the user's requested tasks now. Do not summarize your plan. Perform concrete implementation and test steps. Only stop if you need a specific user decision or missing required information.";
