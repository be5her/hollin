# Assistant

The in-app assistant: a chat with Claude inside the project tab, with every command of the app as its tools.

- **Where it runs:** in the main process (`main.ts`). The API key never leaves main, tool calls go through the registry as `caller: 'assistant'` with the model id as the agent, and the question whether a destructive command may run is asked in the chat. The renderer only sees host events and a few hidden plumbing commands.
- **The loop** (`loop.ts`): one user message starts a run. Each round streams a reply (`client.messages.stream`); when the model asks for tools, every call runs through the registry and the results go back in one user message, until the model ends its turn, is stopped, or has used 25 rounds of tool calls. Image results (commands declared `output: 'image'`, i.e. `view.snapshot`) go back as image blocks, so the model sees the plan it changed. No `thinking` parameter is sent: the listed models think adaptively by default. `max_tokens` is 16,000.
- **Tools:** every non-hidden command, named as for MCP (`toolNameFor`: `plan.wall.add` is `plan_wall_add`), with its zod input as JSON Schema (`toolInputSchema`) and its description plus a note when it is gated. Hidden commands are never offered, and a tool name the model makes up is answered with an error result. Project tools act on the chat's project.
- **System prompt:** who the assistant is and how to work (read first, change in one `plan_apply` batch with a clear label, look at the result), `DESIGN_GUIDELINES` from core (the same text the MCP resource serves), then the live part: the project's name, its levels with ids and elevations, and the user's display units. The stable part carries a cache breakpoint.
- **Attribution and undo:** every edit the assistant makes is a transaction with the command's own label and the author `{ kind: 'assistant', name: <model id> }`, so the History panel shows "Assistant (claude-…)" and one Ctrl+Z undoes a whole `plan.apply` batch.
- **Confirmation:** mutating commands (deletes, writes outside the library) reach `host.confirmMutation`, which this module installs when it starts. It finds the chat the running tool call belongs to (an `AsyncLocalStorage` around each call), puts the request in the chat (`status: 'waiting'`, `confirm: { id, command, input }`) and waits for the hidden `assistant.confirm.reply`; declined calls return `MUTATION_DECLINED` to the model as an error result. A mutating assistant call made outside a chat has nobody to ask and is declined. Stopping the run or closing the project declines a pending confirmation.
- **Failures:** API errors end the run with a short reason (`error` in the chat state: a refused key, rate limiting, no connection); the API history is trimmed back to before the failed message, so the conversation never ends mid-round. Stopping a run (`assistant.cancel`) aborts the request the same way.
- **Streaming to the window:** `assistant.event { projectId, event }`: `{ type: 'changed', state }` after every structural change (a message, a tool call starting or ending, a confirmation, the run ending), `{ type: 'text', id, delta }` for each piece of a streaming reply. The chat panel loads `assistant.state` when it opens and follows the events.
- **Pointing the SDK elsewhere:** the environment variable `STUDIO_AI_BASE_URL`, read when a run builds its client, replaces the API's base URL. The smoke test sets it to its fake API (`fake-api.ts`); it also serves a proxy. Never set in normal use.

## Storage

Nothing. A chat lives in memory while its project is open and is dropped when the project closes or the app quits. The key is a secret (`host.secrets`, see the settings module), the model `config.ai.model`.

## Agents

Every command here is hidden: `assistant.status` (a key is set, which model), `assistant.state`, `assistant.send`, `assistant.cancel`, `assistant.clear`, `assistant.confirm.reply`. Agents over MCP cannot drive the assistant or read its chat.

## Dependency

`@anthropic-ai/sdk`: the Claude API client (streaming, typed errors, the request and content types). External in the main bundle (it ships a CommonJS entry) and a root dependency, so electron-builder packages it.

## Verified by

Unit tests: `assistant.test.ts` against `fake-api.ts` (a local stand-in for the API that streams scripted turns as server-sent events and records every request): no key refused with `UNAVAILABLE`; a tool call run through the registry as the assistant with the model as agent, its result in the next request, the reply streamed as text events, a second message refused while the run goes; an image result as an image block; a mutating call pausing the run until the user declines (the model gets `MUTATION_DECLINED`) or allows it; a direct assistant call outside a chat declined and hidden commands never offered; a 401 reported as a refused key with the conversation trimmed; cancel while waiting. Smoke: `src/main/smoke/host.ts` (a direct mutating assistant call declined) and, from step 4, `src/main/smoke/assistant-ui.ts`.
