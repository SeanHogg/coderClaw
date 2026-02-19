/**
 * CLI command for initializing coderClaw projects
 */

import { intro, outro, text, confirm, spinner } from "@clack/prompts";
import { Command } from "commander";
import { initializeCoderClawProject, isCoderClawProject } from "../coderclaw/project-context.js";
import { theme } from "../terminal/theme.js";

export function createCoderClawCommand(): Command {
  const cmd = new Command("coderclaw");

  cmd
    .description("Developer-first multi-agent AI system for code workflows")
    .addCommand(createInitCommand())
    .addCommand(createStatusCommand());

  return cmd;
}

function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize a project with coderClaw")
    .argument("[path]", "Project directory path", ".")
    .action(async (projectPath: string) => {
      intro(theme.accent("coderClaw init"));

      const projectRoot = projectPath === "." ? process.cwd() : projectPath;

      // Check if already initialized
      const isInitialized = await isCoderClawProject(projectRoot);
      if (isInitialized) {
        outro(theme.warn("Project is already initialized with coderClaw"));
        return;
      }

      // Gather project information
      const projectName = await text({
        message: "Project name:",
        placeholder: "my-project",
      });

      if (typeof projectName === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      const description = await text({
        message: "Project description:",
        placeholder: "A brief description of what this project does",
      });

      if (typeof description === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      const languages = await text({
        message: "Primary languages (comma-separated):",
        placeholder: "typescript, javascript",
      });

      if (typeof languages === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      const frameworks = await text({
        message: "Frameworks used (comma-separated):",
        placeholder: "express, react",
      });

      if (typeof frameworks === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      const shouldInit = await confirm({
        message: "Initialize coderClaw in this project?",
      });

      if (typeof shouldInit === "symbol" || !shouldInit) {
        outro(theme.muted("Cancelled"));
        return;
      }

      // Initialize project
      const spin = spinner();
      spin.start("Initializing coderClaw project...");

      try {
        await initializeCoderClawProject(projectRoot, {
          projectName: projectName,
          description: description,
          languages: typeof languages === "string" ? languages.split(",").map((l) => l.trim()) : [],
          frameworks:
            typeof frameworks === "string" ? frameworks.split(",").map((f) => f.trim()) : [],
        });

        spin.stop(theme.success("coderClaw initialized successfully!"));
        outro(
          theme.muted(
            `Project context created in ${projectRoot}/.coderClaw/\n` +
              `Edit context.yaml, architecture.md, and rules.yaml to customize your project.`,
          ),
        );
      } catch (error) {
        spin.stop(theme.error("Failed to initialize project"));
        outro(theme.error(error instanceof Error ? error.message : String(error)));
      }
    });
}

function createStatusCommand(): Command {
  return new Command("status")
    .description("Show coderClaw project status and context")
    .argument("[path]", "Project directory path", ".")
    .action(async (projectPath: string) => {
      const projectRoot = projectPath === "." ? process.cwd() : projectPath;

      const isInitialized = await isCoderClawProject(projectRoot);

      if (!isInitialized) {
        console.log(theme.warn("Project is not initialized with coderClaw"));
        console.log(theme.muted(`Run 'openclaw coderclaw init' to initialize`));
        return;
      }

      console.log(theme.success("✓ coderClaw project detected"));
      console.log(theme.muted(`  Location: ${projectRoot}/.coderClaw/`));
    });
}
