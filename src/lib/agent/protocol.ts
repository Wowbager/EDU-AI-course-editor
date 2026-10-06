/**
 * The chat wire format between the browser and the editor's server.
 *
 * Headless and provider-neutral: the browser keeps an append-only list of these
 * messages, and the server maps them to whichever OpenAI-compatible provider is
 * configured (`server/ai/provider.ts`). Nothing here names a provider.
 */

/** A complete tool call. `arguments` is the model's raw JSON text, never parsed here. */
export type ToolCall = { id: string; name: string; arguments: string };

export type UserMessage = { role: 'user'; content: string };

export type AssistantMessage = {
	role: 'assistant';
	text: string;
	toolCalls: ToolCall[];
	/**
	 * The model's reasoning, as the provider returned it. Opaque: the browser stores it and
	 * sends it back unchanged on every later turn, because providers require that when
	 * tools are used (a string for one provider, an array of blocks for another).
	 */
	reasoning?: unknown;
};

export type ToolMessage = { role: 'tool'; toolCallId: string; content: string };

/** An operator or system notice placed in the conversation at this position. */
export type NoticeMessage = { role: 'notice'; content: string };

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage | NoticeMessage;

/** The POST body of `/ai/chat`. The server owns the system prompt and the tools. */
export type ChatRequest = { messages: ChatMessage[] };

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export type Usage = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	/** Prompt tokens served from the provider's cache, when it says. */
	cachedTokens?: number;
};

export type StreamEvent =
	| { type: 'text_delta'; text: string }
	/** Kept, not shown to the teacher. */
	| { type: 'reasoning_delta'; text: string }
	/** Sent once the stream has assembled the arguments. */
	| ({ type: 'tool_call' } & ToolCall)
	| { type: 'done'; finishReason: FinishReason; assistant: AssistantMessage; usage: Usage }
	/** `message` is Czech and meant for the teacher. */
	| { type: 'error'; message: string; code: ErrorCode };

export type ErrorCode =
	| 'not_configured'
	| 'auth'
	| 'rate_limit'
	| 'budget'
	| 'overloaded'
	| 'payment'
	| 'context_length'
	| 'bad_request'
	| 'timeout'
	| 'network'
	| 'unavailable'
	| 'unknown';
