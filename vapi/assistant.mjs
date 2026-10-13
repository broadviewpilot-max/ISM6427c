// Builds the Vapi assistant for The Aimsir Foundation's phone line.
// Run `node vapi/assistant.mjs` for usage. No dependencies; Node 20+.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.vapi.ai';

export function buildAssistant(env = process.env) {
  const agentName = (env.AGENT_NAME || 'Walter').trim();
  const transfer = (env.TRANSFER_NUMBER || '').trim();
  if (transfer && !/^\+[1-9]\d{6,14}$/.test(transfer)) {
    throw new Error('TRANSFER_NUMBER must be E.164 format, e.g. +19545550123');
  }

  const prompt = readFileSync(join(here, 'system-prompt.md'), 'utf8').replaceAll('{{AGENT_NAME}}', agentName);

  const tools = [{ type: 'endCall' }];
  if (transfer) {
    tools.push({
      type: 'transferCall',
      destinations: [{
        type: 'number',
        number: transfer,
        name: 'Aimsir Foundation staff',
        message: 'Let me get you to someone on our team. One moment.',
        description: 'Transfer when the caller asks for a person, wants sponsorship, partnership, media or donation-issue help, or asks something the assistant cannot answer confidently.',
      }],
    });
  }

  const assistant = {
    name: `Aimsir Foundation - ${agentName}`,
    // The agent speaks first.
    firstMessageMode: 'assistant-speaks-first',
    firstMessage: `Thank you for calling The Aimsir Foundation. Inspiring the skies, changing lives. This is ${agentName}, the Foundation's virtual aviation advisor. How can I help you today?`,
    model: {
      provider: 'anthropic',
      model: env.VAPI_MODEL || 'claude-sonnet-4-6',
      temperature: 0.4,
      maxTokens: 300,
      messages: [{ role: 'system', content: prompt }],
      tools,
    },
    // Built-in Vapi male voice (named in Vapi's own docs examples). Swap voiceId to audition others.
    voice: { provider: 'vapi', voiceId: env.VAPI_VOICE_ID || 'Elliot' },
    backgroundDenoisingEnabled: true,
    maxDurationSeconds: 600,
    silenceTimeoutSeconds: 30,
    endCallMessage: 'Thank you for calling The Aimsir Foundation. Inspiring the skies, changing lives. Goodbye.',
    endCallPhrases: ['goodbye', 'have a great day'],
    voicemailMessage: 'Hello, this is The Aimsir Foundation returning your call. Please call us back at 844, 8 A I M S I R, or email sean dot smith at the Aimsir Foundation dot org. Inspiring the skies, changing lives.',
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: 'object',
          properties: {
            callerType: { type: 'string', enum: ['student', 'parent', 'donor', 'sponsor', 'volunteer-or-mentor', 'partner', 'media', 'other'] },
            reason: { type: 'string' },
            callerName: { type: 'string' },
            callbackContact: { type: 'string' },
            followUpNeeded: { type: 'boolean' },
          },
        },
      },
    },
    metadata: { project: 'aimsir-foundation-voice-agent', persona: agentName },
  };

  if (env.SERVER_URL) assistant.server = { url: env.SERVER_URL };
  return assistant;
}

async function call(method, path, key, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vapi ${method} ${path} -> ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const [cmd, id] = process.argv.slice(2);
  if (!['dry-run', 'create', 'update'].includes(cmd) || (cmd === 'update' && !id)) {
    console.log('Usage:\n  node vapi/assistant.mjs dry-run            print the payload, send nothing\n  node vapi/assistant.mjs create             create the assistant (needs VAPI_API_KEY)\n  node vapi/assistant.mjs update <id>        update an existing assistant');
    console.log('\nEnv: VAPI_API_KEY, AGENT_NAME (default Walter), TRANSFER_NUMBER (E.164, optional),\n     VAPI_MODEL, VAPI_VOICE_ID, SERVER_URL');
    process.exit(cmd ? 1 : 0);
  }
  const payload = buildAssistant();
  if (cmd === 'dry-run') return console.log(JSON.stringify(payload, null, 2));
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error('Set VAPI_API_KEY (Vapi dashboard -> API Keys, private key).');
  const out = cmd === 'create' ? await call('POST', '/assistant', key, payload) : await call('PATCH', `/assistant/${id}`, key, payload);
  console.log(`${cmd === 'create' ? 'Created' : 'Updated'} assistant ${out.id} (${out.name})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
