# HVAC Voice Agent

An AI phone receptionist for an after-hours HVAC company. It answers incoming
calls, has a natural spoken conversation to capture the caller's details
(name, address, problem, urgency, callback number), confirms them back, and
files the lead — appending a row to a Google Sheet and texting the caller an
SMS confirmation.

Built as a demo with [Twilio](https://www.twilio.com/) for telephony, the
[OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
(`gpt-realtime`) for speech-to-speech conversation, and
[n8n](https://n8n.io/) for the downstream integrations.

## How it works

```
 Caller ──dials──▶ Twilio number
                     │  (Voice webhook → TwiML <Connect><Stream>)
                     ▼
             Fastify server (index.js)
             ├─ /incoming-call  → returns TwiML that opens a media stream
             └─ /media-stream   → WebSocket bridge:
                    Twilio audio  ⇄  OpenAI Realtime API (gpt-realtime)
                     │
                     │  model calls the save_lead function tool once
                     │  all fields are collected and confirmed
                     ▼
             POST N8N_WEBHOOK_URL  ──▶  n8n workflow
                                          ├─ Append row to Google Sheet
                                          └─ Send SMS confirmation (Twilio)
```

The server relays μ-law audio in both directions over WebSockets. When the
model has gathered and confirmed every field, it calls the `save_lead`
function tool; the server forwards that lead to an n8n webhook (fire-and-forget,
so a downstream hiccup never interrupts the live call) and tells the model the
lead was saved so it can thank the caller. n8n owns the Google Sheet append and
the SMS confirmation, configured in its own UI (see `n8n/hvac-lead-workflow.json`).

## Stack

- **Node.js** (ES modules) + **Fastify** — HTTP + WebSocket server
- **@fastify/websocket**, **ws** — Twilio ⇄ OpenAI audio bridge
- **Twilio** — phone number, inbound voice, outbound SMS
- **OpenAI Realtime API** (`gpt-realtime`, GA) — real-time voice conversation
- **n8n** — Google Sheets append + SMS confirmation
- **ngrok** — exposes the local server to Twilio during development

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment** — copy the example and fill in your values:
   ```bash
   cp .env.example .env
   ```
   | Variable | Description |
   |---|---|
   | `OPENAI_API_KEY` | OpenAI key with Realtime API access |
   | `N8N_WEBHOOK_URL` | Production webhook URL of your n8n workflow |
   | `PORT` | Port the server listens on (default `5050`) |

3. **Run the server**
   ```bash
   node index.js
   ```

4. **Expose it to Twilio** (development)
   ```bash
   ngrok http 5050
   ```
   Point your Twilio number's *"A call comes in"* Voice webhook at
   `https://<your-subdomain>.ngrok-free.dev/incoming-call` (HTTP POST).

5. **Build the n8n workflow** — import `n8n/hvac-lead-workflow.json`, connect a
   Google Sheets credential (pick the spreadsheet + tab) and a Twilio credential
   (set the *From* number), then **publish/activate** it and paste its
   production webhook URL into `N8N_WEBHOOK_URL`.

6. **Call your Twilio number** and talk to the agent.

## Notes

- The `save_lead` tool captures `name`, `address`, `problem`
  (`AC out` / `no heat` / `install quote` / `maintenance`), `urgency`
  (`emergency` / `same day` / `this week` / `flexible`), and `callback_number`.
- This is a demo. For production you'd want Twilio request-signature validation
  on the webhooks, "ring the shop first, AI picks up on no-answer" call
  forwarding, an emergency address on the Twilio number, and A2P 10DLC
  registration before relying on SMS.

## License

ISC
