# coderClaw: Multi-Agent Developer System

coderClaw is a developer-first multi-agent AI system integrated into OpenClaw. It provides deep codebase understanding, intelligent orchestration, and specialized agent roles for comprehensive software development workflows.

## Core Capabilities

### 1. Deep Knowledge & Context Engine

coderClaw builds and maintains a persistent, structured project knowledge model:

- **AST Parsing**: Extracts semantic information from TypeScript/JavaScript code
- **Code Maps**: Tracks functions, classes, interfaces, types, and their relationships
- **Dependency Graphs**: Understands file dependencies and impact radius
- **Cross-File References**: Tracks imports, exports, and usage patterns
- **Git History**: Analyzes evolution, blame, and change patterns

### 2. Multi-Agent Orchestration

Coordinate multiple specialized agents to work together on complex tasks:

- **Workflow Patterns**: Pre-built workflows for features, bug fixes, and refactoring
- **Custom Workflows**: Define your own multi-step agent coordination
- **Task Management**: Track status, dependencies, and results
- **Parallel Execution**: Run independent tasks simultaneously
- **Result Aggregation**: Combine outputs from multiple agents

### 3. Specialized Agent Roles

Built-in developer-centric agents:

- **Code Creator**: Implements features and generates code
- **Code Reviewer**: Reviews code for quality, security, and best practices
- **Test Generator**: Creates comprehensive test suites
- **Bug Analyzer**: Diagnoses and fixes bugs systematically
- **Refactor Agent**: Improves code structure while preserving behavior
- **Documentation Agent**: Creates clear, helpful documentation
- **Architecture Advisor**: Provides high-level design guidance

## Project Structure

coderClaw stores project-specific context in a `.coderClaw/` directory:

\`\`\`
.coderClaw/
├── context.yaml # Project metadata, languages, frameworks
├── architecture.md # Architectural documentation
├── rules.yaml # Coding standards and conventions
├── agents/ # Custom agent role definitions
│ ├── reviewer.yaml
│ └── tester.yaml
├── skills/ # Project-specific skills
└── memory/ # Project knowledge cache
\`\`\`

## Getting Started

### Initialize a Project

\`\`\`bash

# In your project directory

openclaw coderclaw init

# Or specify a path

openclaw coderclaw init /path/to/project
\`\`\`

This creates the `.coderClaw/` directory with default configuration.

### Check Project Status

\`\`\`bash
openclaw coderclaw status
\`\`\`

## Using coderClaw Tools

Once initialized, agents in your project have access to coderClaw tools:

### Code Analysis

Analyze code structure and dependencies:

\`\`\`
code_analysis projectRoot:/path/to/project
\`\`\`

### Project Knowledge

Query project context and rules:

\`\`\`
project_knowledge projectRoot:/path/to/project query:all
project_knowledge projectRoot:/path/to/project query:rules
project_knowledge projectRoot:/path/to/project query:architecture
\`\`\`

### Git History

Analyze git history and patterns:

\`\`\`
git_history projectRoot:/path/to/project
git_history projectRoot:/path/to/project path:src/api/ limit:20
git_history projectRoot:/path/to/project author:john@example.com
\`\`\`

### Orchestrate Workflows

Create multi-agent workflows:

\`\`\`

# Feature development workflow

orchestrate workflow:feature description:"Add user authentication"

# Bug fix workflow

orchestrate workflow:bugfix description:"Fix memory leak in parser"

# Refactoring workflow

orchestrate workflow:refactor description:"Refactor API module"
\`\`\`

### Check Workflow Status

\`\`\`
workflow_status workflowId:abc-123-def
\`\`\`

## Workflow Patterns

### Feature Development

Coordinates: Architecture Advisor → Code Creator → Test Generator → Code Reviewer

\`\`\`
orchestrate workflow:feature description:"Add WebSocket support"
\`\`\`

### Bug Fix

Coordinates: Bug Analyzer → Code Creator → Test Generator → Code Reviewer

\`\`\`
orchestrate workflow:bugfix description:"Fix race condition in cache"
\`\`\`

### Refactoring

Coordinates: Code Reviewer → Refactor Agent → Test Generator

\`\`\`
orchestrate workflow:refactor description:"Refactor authentication module"
\`\`\`

### Custom Workflow

Define your own workflow steps:

\`\`\`
orchestrate workflow:custom description:"Custom task" customSteps:[
{
role: "architecture-advisor",
task: "Analyze current architecture"
},
{
role: "code-creator",
task: "Implement changes",
dependsOn: ["Analyze current architecture"]
},
{
role: "documentation-agent",
task: "Update documentation",
dependsOn: ["Implement changes"]
}
]
\`\`\`

## Custom Agent Roles

Define project-specific agent roles in `.coderClaw/agents/`:

\`\`\`yaml

# .coderClaw/agents/api-specialist.yaml

name: api-specialist
description: Expert in API design and implementation for this project
capabilities:

- Design RESTful APIs
- Implement GraphQL resolvers
- Write API documentation
- Create API tests
  tools:
- create
- edit
- view
- bash
  systemPrompt: |
  You are an API specialist for this project.
  Focus on RESTful design, proper error handling, and clear documentation.
  Follow the project's API conventions defined in docs/api-standards.md.
  model: anthropic/claude-sonnet-4-20250514
  thinking: medium
  \`\`\`

## Integration with Existing OpenClaw Features

coderClaw extends OpenClaw's existing capabilities:

- **Skills**: Use coding-agent skill for interactive development
- **Subagents**: Orchestrate workflows spawn subagents automatically
- **Memory**: Project knowledge integrates with OpenClaw's memory system
- **Tools**: coderClaw tools available alongside existing OpenClaw tools
- **Workspace**: Project context complements workspace-level configuration

## Architecture

coderClaw is built on OpenClaw's existing infrastructure:

- **Tool System**: Uses AgentTool interface for consistency
- **Subagent Spawning**: Leverages existing subagent lifecycle management
- **Session Management**: Integrates with OpenClaw's session tracking
- **Configuration**: Extends OpenClaw config structure

## Security

coderClaw respects OpenClaw's security model:

- Project context files are read-only during execution
- Code analysis runs with same permissions as other tools
- Workflow execution follows existing tool policy
- No external network access during local code analysis

## Best Practices

1. **Initialize projects early**: Run `coderclaw init` when starting new projects
2. **Keep context updated**: Update `architecture.md` as your design evolves
3. **Define clear rules**: Specify coding standards in `rules.yaml`
4. **Use workflows for complex tasks**: Leverage orchestration for multi-step work
5. **Create custom agents**: Define project-specific roles as needed
6. **Review workflow results**: Check task outputs and iterate as needed

## Future Enhancements

Planned features:

- Additional language support (Python, Go, Java, Rust)
- Real-time code indexing and watching
- Integration with IDE language servers
- Enhanced semantic search across codebases
- Automated architecture documentation generation
- PR and issue awareness
- Cross-repository dependency tracking
