/**
 * GitHub Issue → PR end-to-end workflow tool
 *
 * Fetches a GitHub issue, spawns an orchestrator workflow (feature/bugfix based
 * on labels), and optionally opens a draft PR when the implementation is ready.
 *
 * Requires: GITHUB_TOKEN in the environment (or process.env.GITHUB_TOKEN).
 *
 * Usage by an agent:
 *   github_issue_workflow({ issue: "owner/repo#42" })
 *   github_issue_workflow({ issue: "https://github.com/owner/repo/issues/42" })
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import {
  globalOrchestrator,
  createFeatureWorkflow,
  createBugFixWorkflow,
  type SpawnSubagentContext,
} from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const GithubIssueWorkflowSchema = Type.Object({
  issue: Type.String({
    description:
      "GitHub issue reference.  Accepts:\n" +
      "  • Full URL: https://github.com/owner/repo/issues/42\n" +
      "  • Short form: owner/repo#42",
  }),
  projectRoot: Type.Optional(
    Type.String({
      description: "Absolute path to the project root (defaults to process.cwd())",
    }),
  ),
  branchPrefix: Type.Optional(
    Type.String({
      description: "Git branch name prefix, e.g. 'claw/'. Default: 'claw/issue-'",
    }),
  ),
  createPr: Type.Optional(
    Type.Boolean({
      description: "Create a draft PR on GitHub when implementation completes. Default: true.",
    }),
  ),
});

type GithubIssueWorkflowParams = {
  issue: string;
  projectRoot?: string;
  branchPrefix?: string;
  createPr?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<{ name: string }>;
  state: string;
}

interface ParsedIssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse "owner/repo#42" or full GitHub URL into components. */
function parseIssueRef(ref: string): ParsedIssueRef | null {
  // Full URL: https://github.com/owner/repo/issues/42
  const urlMatch = ref.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3], 10) };
  }
  // Short form: owner/repo#42
  const shortMatch = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3], 10) };
  }
  return null;
}

/** Fetch a GitHub issue using the REST API. */
async function fetchIssue(ref: ParsedIssueRef, token: string): Promise<GitHubIssue> {
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "CoderClaw/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<GitHubIssue>;
}

/**
 * Determine whether the issue should use a feature or bugfix workflow.
 * Heuristic: any of the common "bug" labels → bugfix, otherwise feature.
 */
function classifyIssue(issue: GitHubIssue): "feature" | "bugfix" {
  const bugLabels = new Set(["bug", "bugfix", "defect", "fix", "regression"]);
  for (const label of issue.labels) {
    if (bugLabels.has(label.name.toLowerCase())) return "bugfix";
  }
  return "feature";
}

/** Sanitise a string for use as a git branch name component. */
function toBranchSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Create a draft PR via GitHub API.
 * Returns the PR URL, or null if creation failed.
 */
async function createGitHubPR(opts: {
  owner: string;
  repo: string;
  token: string;
  head: string; // branch name
  base: string; // target branch (e.g. "main")
  title: string;
  body: string;
}): Promise<string | null> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
        "User-Agent": "CoderClaw/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
        draft: true,
      }),
    });
    if (!res.ok) return null;
    const pr = (await res.json()) as { html_url: string };
    return pr.html_url;
  } catch {
    return null;
  }
}

/** Get the default branch of a repo (typically "main" or "master"). */
async function getDefaultBranch(owner: string, repo: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "CoderClaw/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { default_branch: string };
      return data.default_branch ?? "main";
    }
  } catch {
    // fallback
  }
  return "main";
}

// ---------------------------------------------------------------------------
// Tool factory (mirrors createOrchestrateTool pattern — needs spawn context)
// ---------------------------------------------------------------------------

export function createGithubIssueWorkflowTool(
  spawnContext?: SpawnSubagentContext,
): AgentTool<typeof GithubIssueWorkflowSchema, string> {
  const context: SpawnSubagentContext = spawnContext ?? {};

  return {
    name: "github_issue_workflow",
    label: "GitHub Issue → PR Workflow",
    description:
      "Fetch a GitHub issue, execute a multi-agent implementation workflow " +
      "(feature or bugfix based on labels), and optionally open a draft PR when done. " +
      "Requires GITHUB_TOKEN in the environment.",
    parameters: GithubIssueWorkflowSchema,

    async execute(
      _toolCallId: string,
      params: GithubIssueWorkflowParams,
    ): Promise<AgentToolResult<string>> {
      const { issue: issueRef, branchPrefix = "claw/issue-", createPr = true } = params;

      // Resolve GitHub token
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
      if (!token) {
        return jsonResult({
          error:
            "GITHUB_TOKEN is not set. Export it in your environment or set it in .coderClaw config env.vars.",
        }) as AgentToolResult<string>;
      }

      // Parse issue reference
      const ref = parseIssueRef(issueRef);
      if (!ref) {
        return jsonResult({
          error: `Cannot parse issue reference: "${issueRef}". Expected "owner/repo#42" or a full GitHub URL.`,
        }) as AgentToolResult<string>;
      }

      // Fetch issue from GitHub
      let issue: GitHubIssue;
      try {
        issue = await fetchIssue(ref, token);
      } catch (err) {
        return jsonResult({
          error: `Failed to fetch issue: ${String(err)}`,
        }) as AgentToolResult<string>;
      }

      if (issue.state === "closed") {
        return jsonResult({
          warning: `Issue #${ref.number} is already closed. Proceeding anyway.`,
          issue: { number: issue.number, title: issue.title, state: issue.state },
        }) as AgentToolResult<string>;
      }

      // Classify + build workflow steps
      const kind = classifyIssue(issue);
      const issueDescription =
        `${issue.title}\n\n${issue.body ?? ""}`.trim() + `\n\nFixes: ${issue.html_url}`;

      const steps =
        kind === "feature"
          ? createFeatureWorkflow(issueDescription)
          : createBugFixWorkflow(issueDescription);

      // Create and register the branch name before workflow starts
      const branchSlug = toBranchSlug(issue.title);
      const branchName = `${branchPrefix}${ref.number}-${branchSlug}`;

      // Run the workflow
      const workflow = globalOrchestrator.createWorkflow(steps);
      let resultsMap: Map<string, string>;
      let succeeded = false;
      try {
        resultsMap = await globalOrchestrator.executeWorkflow(workflow.id, context);
        succeeded = workflow.status === "completed";
      } catch (err) {
        return jsonResult({
          error: `Workflow execution failed: ${String(err)}`,
          workflowId: workflow.id,
          issue: { number: issue.number, title: issue.title },
        }) as AgentToolResult<string>;
      }

      // Attempt to create a PR if requested and workflow succeeded
      let prUrl: string | null = null;
      if (createPr && succeeded) {
        const defaultBranch = await getDefaultBranch(ref.owner, ref.repo, token);
        const prTitle = `${kind === "bugfix" ? "fix" : "feat"}: resolve #${ref.number} — ${issue.title}`;
        const prBody =
          `## Summary\n\nThis PR was generated by CoderClaw in response to issue #${ref.number}.\n\n` +
          `**Issue:** ${issue.html_url}\n\n` +
          `### Changes\n\n_Implemented by multi-agent ${kind} workflow._\n\n` +
          `Closes #${ref.number}`;

        prUrl = await createGitHubPR({
          owner: ref.owner,
          repo: ref.repo,
          token,
          head: branchName,
          base: defaultBranch,
          title: prTitle,
          body: prBody,
        });
      }

      return jsonResult({
        issue: {
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          kind,
        },
        workflow: {
          id: workflow.id,
          status: workflow.status,
          tasks: resultsMap.size,
        },
        branch: branchName,
        pr: prUrl ? { url: prUrl, draft: true } : null,
        message: succeeded
          ? `Workflow completed successfully.${prUrl ? ` Draft PR created: ${prUrl}` : " Commit changes and push the branch to open a PR."}`
          : "Workflow encountered errors. Review the task outputs above.",
      }) as AgentToolResult<string>;
    },
  };
}
