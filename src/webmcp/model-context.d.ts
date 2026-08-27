/**
 * Ambient types for the WebMCP proposal (webmachinelearning.github.io/webmcp).
 * Chrome 146+ behind chrome://flags/#enable-webmcp-testing; origin trial
 * 149-156. Use document.modelContext: the navigator.modelContext alias is
 * deprecated since Chrome 150 and reported removed in 152.
 */

interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
}

interface ToolExecuteCallbackOptions {
  readonly signal: AbortSignal;
}

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  annotations?: ToolAnnotations;
  execute(
    input: unknown,
    options: ToolExecuteCallbackOptions,
  ): Promise<unknown>;
}

interface ModelContextRegisterToolOptions {
  readonly exposedTo?: readonly string[];
  readonly signal?: AbortSignal;
}

interface RegisteredToolInfo {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly origin?: string;
  readonly annotations?: ToolAnnotations;
}

interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions,
  ): Promise<undefined>;
  getTools(options?: { fromOrigins?: readonly string[] }): Promise<RegisteredToolInfo[]>;
  executeTool(
    tool: RegisteredToolInfo,
    inputObject?: object,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
}

interface Document {
  readonly modelContext?: ModelContext;
}
