import { existsSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import OpenAI from 'openai';

if (existsSync('.env')) process.loadEnvFile('.env');

const apiKey = process.env.OPENAI_API_KEY?.trim();
const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const model = process.env.OPENAI_MODEL || 'gpt-4o';

if (!apiKey) {
  console.error(
    'OPENAI_API_KEY is missing. Set it in .env and run npm run check:ai again.',
  );
  process.exit(1);
}

try {
  const client = new OpenAI({ apiKey, baseURL, timeout: 30000, maxRetries: 0 });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'user', content: 'Call connectivity_check with ok set to true.' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'connectivity_check',
          description: 'Confirm that function calling works.',
          parameters: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'connectivity_check' } },
  });
  const call = response.choices[0]?.message.tool_calls?.find(
    (item) =>
      item.type === 'function' && item.function.name === 'connectivity_check',
  );
  if (!call || JSON.parse(call.function.arguments).ok !== true) {
    throw new Error('The model did not return the required function call.');
  }
  console.log(`AI connection OK: ${model} supports function calling.`);
} catch (error) {
  console.error(
    `AI check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
