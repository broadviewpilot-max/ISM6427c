# Aimsir Foundation voice agent (Vapi)

A phone assistant for The Aimsir Foundation. It speaks first, sounds like a calm veteran captain, answers questions on scholarships, mentorship, donating and partnering, and hands off to a person when it should.

## Use

```sh
node vapi/assistant.mjs dry-run                      # inspect the payload; sends nothing
VAPI_API_KEY=... TRANSFER_NUMBER=+1XXXXXXXXXX node vapi/assistant.mjs create
VAPI_API_KEY=... node vapi/assistant.mjs update <assistant-id>
```

Use a **private** key from the Vapi dashboard. Never commit it. Then attach the assistant to a phone number in the dashboard (Phone Numbers -> Assistant).

| Variable | Purpose |
| --- | --- |
| `VAPI_API_KEY` | Required for `create` / `update` |
| `AGENT_NAME` | Persona name (default `Marcus`, a placeholder) |
| `TRANSFER_NUMBER` | E.164 staff number. Without it there is no transfer tool and the agent takes a message |
| `VAPI_MODEL` | Default `claude-sonnet-4-6` (valid in Vapi's API reference; `claude-sonnet-5` also listed) |
| `VAPI_VOICE_ID` | Default Vapi built-in `Elliot`. Audition others in the dashboard |
| `SERVER_URL` | Optional webhook for end-of-call reports |

## Where facts come from

`system-prompt.md` uses only what is on theaimsirfoundation.org and the Foundation's posts (retrieved 2026-10-13). Re-check it when programs, scholarship windows or sponsorship tiers change. It deliberately sends callers to the website for the current scholarship window.

## Review before going live

- Persona name, and whether the agent should state that it is an AI (it currently does when asked and in the greeting).
- Transfer number and who answers it.
- The `info@` address appears as both `.org` and `.com` in Foundation posts. The prompt uses `.org`; confirm.
- The public donate page prints bank account and routing numbers. The agent never reads these and never takes payment details.
- Make several test calls (student, parent, donor, sponsor, off-topic, a request for a human) before publishing the number.
- Post-call summaries and structured data (caller type, reason, callback contact) appear in the Vapi call log. They contain personal information; restrict dashboard access.
