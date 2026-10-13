import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistant } from '../vapi/assistant.mjs';

test('agent speaks first and uses the verified male Vapi voice', () => {
  const a = buildAssistant({});
  assert.equal(a.firstMessageMode, 'assistant-speaks-first');
  assert.match(a.firstMessage, /Aimsir Foundation/);
  assert.equal(a.voice.provider, 'vapi');
  assert.equal(a.voice.voiceId, 'Elliot');
  assert.equal(a.model.provider, 'anthropic');
});

test('persona name is substituted and no placeholder leaks', () => {
  const a = buildAssistant({ AGENT_NAME: 'Walter' });
  const sys = a.model.messages[0].content;
  assert.match(sys, /You are Walter/);
  assert.ok(!sys.includes('{{'));
});

test('transfer tool only exists when a valid E.164 number is set', () => {
  assert.deepEqual(buildAssistant({}).model.tools.map((t) => t.type), ['endCall']);
  const t = buildAssistant({ TRANSFER_NUMBER: '+19545550123' }).model.tools;
  assert.deepEqual(t.map((x) => x.type), ['endCall', 'transferCall']);
  assert.equal(t[1].destinations[0].number, '+19545550123');
  assert.throws(() => buildAssistant({ TRANSFER_NUMBER: '954-555-0123' }), /E\.164/);
});

test('prompt never contains bank details and forbids reading them', () => {
  const sys = buildAssistant({}).model.messages[0].content;
  assert.ok(!/\b9334910057\b|\b063107513\b|\b121000248\b/.test(sys));
  assert.match(sys, /Never read out bank account numbers/);
});

test('contact email is the dot-org Sean Smith address, never the old info@ or .com', () => {
  const a = buildAssistant({});
  const all = a.model.messages[0].content + a.voicemailMessage;
  assert.match(a.model.messages[0].content, /seansmith@theaimsirfoundation\.org/);
  assert.match(a.voicemailMessage, /seansmith, all one word, at the Aimsir Foundation dot org/);
  assert.ok(!/info (at|@)|\.com/.test(all));
});
