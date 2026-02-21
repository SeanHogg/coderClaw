/**
 * Type definitions for coderClaw project-specific context
 */

export type ProjectContext = {
  version: number;
  projectName: string;
  description?: string;
  rootPath: string;
  languages: string[];
  frameworks: string[];
  architecture: {
    style: string;
    layers: string[];
    patterns: string[];
  };
  buildSystem?: string;
  testFramework?: string;
  lintingTools: string[];
  dependencies: {
    production: Record<string, string>;
    development: Record<string, string>;
  };
  customRules: string[];
  metadata?: Record<string, unknown>;
};

export type AgentRole = {
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  systemPrompt?: string;
  model?: string;
  thinking?: string;
  constraints?: string[];
};

export type ProjectRules = {
  version: number;
  codeStyle: {
    indentation: "tabs" | "spaces";
    indentSize?: number;
    lineLength?: number;
    namingConventions?: Record<string, string>;
  };
  testing: {
    required: boolean;
    coverage?: number;
    frameworks: string[];
  };
  documentation: {
    required: boolean;
    format?: string;
    location?: string;
  };
  git: {
    branchNaming?: string;
    commitFormat?: string;
    requireReview?: boolean;
  };
  constraints: string[];
  customRules: string[];
};

export type CodeMap = {
  files: Map<string, FileInfo>;
  dependencies: Map<string, string[]>;
  exports: Map<string, ExportInfo>;
  imports: Map<string, ImportInfo[]>;
};

export type FileInfo = {
  path: string;
  language: string;
  size: number;
  lastModified: Date;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  interfaces: InterfaceInfo[];
  types: TypeInfo[];
};

export type FunctionInfo = {
  name: string;
  line: number;
  params: string[];
  returnType?: string;
  exported: boolean;
  async: boolean;
};

export type ClassInfo = {
  name: string;
  line: number;
  extends?: string;
  implements: string[];
  methods: MethodInfo[];
  exported: boolean;
};

export type MethodInfo = {
  name: string;
  line: number;
  params: string[];
  returnType?: string;
  visibility: "public" | "private" | "protected";
  static: boolean;
  async: boolean;
};

export type InterfaceInfo = {
  name: string;
  line: number;
  extends: string[];
  properties: PropertyInfo[];
  methods: MethodInfo[];
  exported: boolean;
};

export type PropertyInfo = {
  name: string;
  type?: string;
  optional: boolean;
  readonly: boolean;
};

export type TypeInfo = {
  name: string;
  line: number;
  definition: string;
  exported: boolean;
};

export type ExportInfo = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "let" | "var";
  file: string;
  line: number;
};

export type ImportInfo = {
  source: string;
  imports: string[];
  file: string;
  line: number;
};

export type DependencyNode = {
  file: string;
  dependencies: string[];
  dependents: string[];
};

export type GitHistoryEntry = {
  sha: string;
  author: string;
  date: Date;
  message: string;
  filesChanged: string[];
};

export type ProjectKnowledge = {
  context: ProjectContext;
  codeMap: CodeMap;
  dependencyGraph: Map<string, DependencyNode>;
  gitHistory: GitHistoryEntry[];
  lastUpdated: Date;
};

/**
 * A session handoff document that lets the next agent session resume where
 * the last one stopped — the CoderClaw alternative to Claude Projects session notes.
 */
export type SessionHandoff = {
  /** Unique identifier for this session */
  sessionId: string;
  /** ISO timestamp of when the session ended */
  timestamp: string;
  /** One-paragraph summary of what was accomplished */
  summary: string;
  /** Key decisions made during the session */
  decisions: string[];
  /** Concrete next steps for the following session */
  nextSteps: string[];
  /** Unresolved questions to revisit */
  openQuestions: string[];
  /** Files, docs, or other artifacts produced */
  artifacts: string[];
  /** Arbitrary extra context to carry forward */
  context?: Record<string, unknown>;
};
