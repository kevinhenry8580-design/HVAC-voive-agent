# HVAC Voice Agent — Build Log

## 2026-05-07

### Done
- Installed Node v20.20.2 and npm 10.8.2 via nvm
- Created project folder ~/projects/hvac-voice-agent
- Opened folder in VS Code

### Next
- Create Twilio account, add $20 credit, buy a phone number
- Create OpenAI account, add $20 credit, generate API key with Realtime API access

### Stuck on
- Nothing yet
## 2026-05-07 (continued)

### Done
- Twilio account created, business use, $20 credit added
- Bought Twilio number: +1 702 XXX XXXX (Voice + SMS capable)

### Next
- Create OpenAI account, generate API key with Realtime access
### Done
- Installed ngrok, authtoken configured
- All tooling in place (Node, npm, git, ngrok)
- All accounts in place (Twilio, OpenAI)

### Next
- Initialize Node project (npm init)
- Install dependencies (Fastify, OpenAI Agents SDK, etc.)
- Write index.js — minimal server that answers a Twilio call
## 2026-05-15

### Done
- Wrote index.js end-to-end: Fastify server, Twilio webhook (/incoming-call), media-stream WebSocket bridge to OpenAI Realtime API
- Installed dependencies: fastify, @fastify/websocket, @fastify/formbody, ws, dotenv
- Added .env (OPENAI_API_KEY, PORT=5050) and .gitignore (node_modules, .env, *.log, .DS_Store)
- Set "type": "module" in package.json for ES imports
- Configured ngrok tunnel (https://<your-subdomain>.ngrok-free.dev → localhost:5050)
- Configured Twilio number (XXX) XXX-XXXX to POST to /incoming-call on incoming calls
- Migrated from deprecated Realtime Beta API to GA: model gpt-realtime, removed OpenAI-Beta header, new session.audio.input/output shape, audio format as { type: 'audio/pcmu' }, event renamed response.audio.delta → response.output_audio.delta
- First successful end-to-end test call — full conversation with AI receptionist

### Next
- Tune SYSTEM_MESSAGE prompt with realistic HVAC scenarios (AC out, no heat, install quote, maintenance)
- Add SMS confirmation to caller after call ends (Twilio SMS)
- Pipe captured info (name, address, problem, urgency) to a Google Sheet for dispatcher
- Implement "ring shop first, AI picks up only if no answer in 3 rings" forwarding logic
- Resolve emergency address on Twilio number (avoid $75 emergency call charge)
- Resolve A2P 10DLC registration before relying on SMS in production

### Stuck on
- Nothing
"Starting. Hour 0. Yesterday I shipped the voice agent end-to-end (Twilio + OpenAI Realtime GA). Today's commit: 0:00–2:00 system prompt + visible call capture, hard stop, then 25-prospect spreadsheet + mystery-shop 5. If I miss the hard stop I switch anyway."

## 2026-06-30

### Done
- Fixed a syntax error in index.js (missing `}` on the OpenAI message handler) that prevented the server from starting — a regression introduced after the May 15 test
- Added structured lead capture: registered a `save_lead` Realtime function tool (name, address, problem, urgency, callback_number); model calls it once details are confirmed
- On save_lead, the agent POSTs the lead to an n8n webhook (N8N_WEBHOOK_URL) and returns function_call_output so the AI confirms to the caller
- n8n owns the downstream integrations: Google Sheet append + Twilio SMS confirmation (built in the n8n UI, no app code)
- Added .env.example; added N8N_WEBHOOK_URL to .env
- Boot-tested: server starts, /health and /incoming-call (TwiML) respond correctly

### Next
- Build the n8n workflow: Webhook trigger → Google Sheets (append row) → Twilio (send SMS confirmation), then paste its URL into .env
- Live end-to-end test call to confirm save_lead fires and a row + SMS land
- Implement "ring shop first, AI picks up only if no answer in 3 rings" forwarding logic
- Resolve emergency address on Twilio number (avoid $75 emergency call charge)
- Resolve A2P 10DLC registration before relying on SMS in production

### Stuck on
- Nothing