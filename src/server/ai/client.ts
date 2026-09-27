import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

export interface FunctionCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelReply {
  content: string | null;
  tool_calls?: FunctionCall[];
}

export interface AIClient {
  complete(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[]): Promise<ModelReply>;
}

export function createOpenAIClient(config: {
  apiKey: string;
  baseURL: string;
  model: string;
}): AIClient {
  const sdk = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30000, maxRetries: 0 });
  return {
    async complete(messages, tools) {
      const response = await sdk.chat.completions.create({ model: config.model, messages, tools });
      const message = response.choices[0]?.message;
      if (!message || message.tool_calls?.some((call) => call.type !== 'function')) {
        throw new Error('Invalid model response');
      }
      return { content: message.content, tool_calls: message.tool_calls as FunctionCall[] | undefined };
    },
  };
}
