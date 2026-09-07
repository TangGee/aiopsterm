// Shapes inspected from local Codex, Claude Code and Kimi Code sessions.
// Every value below is synthetic; original conversation text is never copied.
export const corpus = {
  codex: [
    { type: 'session_meta', payload: { id: 'regression-codex', base_instructions: { text: 'REGRESSION_SYSTEM' } } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'REGRESSION_USER' }] } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'REGRESSION_REASONING' }] } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-1', input: 'REGRESSION_TOOL_INPUT' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: 'REGRESSION_TOOL_RESULT' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call-2', arguments: '{"cmd":"echo REGRESSION_COMMAND"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-2', output: 'REGRESSION_COMMAND_RESULT' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'REGRESSION_ASSISTANT' }] } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_tokens: 50 } } },
    { type: 'future_record', payload: { unknown: 'REGRESSION_FALLBACK' } }
  ],
  claude: [
    { type: 'system', subtype: 'turn_duration', durationMs: 50 },
    { type: 'user', uuid: 'user-1', message: { role: 'user', content: [{ type: 'text', text: 'REGRESSION_USER' }] } },
    { type: 'assistant', uuid: 'assistant-1', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'REGRESSION_REASONING' },
      { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: 'REGRESSION_TOOL_INPUT' } }
    ] } },
    { type: 'user', uuid: 'user-2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'REGRESSION_TOOL_RESULT' }] }] } },
    { type: 'assistant', uuid: 'assistant-2', message: { role: 'assistant', content: [{ type: 'text', text: 'REGRESSION_ASSISTANT' }] } },
    { type: 'future_record', unknown: 'REGRESSION_FALLBACK' }
  ],
  'kimi-code': [
    { type: 'config.update', systemPrompt: 'REGRESSION_SYSTEM' },
    { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: 'REGRESSION_USER' }] } },
    { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'REGRESSION_REASONING' } } },
    { type: 'context.append_loop_event', event: { type: 'tool.call', name: 'ReadFile', args: { path: 'REGRESSION_TOOL_INPUT' } } },
    { type: 'context.append_loop_event', event: { type: 'tool.result', result: { output: [{ type: 'text', text: 'REGRESSION_TOOL_RESULT' }] } } },
    { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'REGRESSION_ASSISTANT' } } },
    { type: 'future_record', unknown: 'REGRESSION_FALLBACK' }
  ]
} as const

export type CorpusAgent = keyof typeof corpus
export function transcriptFor(agent: CorpusAgent, extra = 0) {
  return [...corpus[agent], ...Array.from({ length: extra }, (_, index) => ({ type: 'future_record', text: `REGRESSION_PAGE_${index}` }))]
    .map((record) => JSON.stringify(record)).join('\n') + '\n'
}
