import Fastify from 'fastify';
import WebSocket from 'ws';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const { OPENAI_API_KEY, N8N_WEBHOOK_URL } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Set OPENAI_API_KEY in your .env file.');
    process.exit(1);
}
if (!N8N_WEBHOOK_URL) {
    console.warn('N8N_WEBHOOK_URL not set — captured leads will be logged but not forwarded to n8n.');
}
// System message - tells the AI how to behave
const SYSTEM_MESSAGE = 'You are a friendly receptionist for a Las Vegas HVAC company. Your job is to capture: caller name, address, the problem they are having (AC out, no heat, install quote, or maintenance), how urgent it is, and the best callback number. Keep responses short and natural. Confirm all details back to the caller, and once they confirm, call the save_lead function with the captured details. After the function returns, briefly thank the caller and let them know a technician will follow up.';

// The OpenAI voice to use
const VOICE = 'alloy';

// Send a captured lead to the n8n webhook (which handles the Google Sheet + SMS).
// Fire-and-forget: a failure here is logged but never interrupts the live call.
async function forwardLead(lead) {
    if (!N8N_WEBHOOK_URL) {
        console.warn('Lead captured but N8N_WEBHOOK_URL is not set — skipping forward.');
        return;
    }
    try {
        const res = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...lead, source: 'hvac-voice-agent', received_at: new Date().toISOString() })
        });
        if (!res.ok) {
            console.error(`n8n webhook returned ${res.status} ${res.statusText}`);
        } else {
            console.log('Lead forwarded to n8n');
        }
    } catch (err) {
        console.error('Failed to forward lead to n8n:', err.message);
    }
}

// Create the Fastify server
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const PORT = process.env.PORT || 5050;
// Root route - just a health check so we know the server is up
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'HVAC voice agent is running' });
});

// Twilio webhook - Twilio hits this when a call comes in
fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting you now, please hold.</Say>
    <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
    </Connect>
</Response>`;
    reply.type('text/xml').send(twimlResponse);
});
// WebSocket route - Twilio connects here for the live audio stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Twilio client connected');

        // Open a WebSocket to OpenAI's Realtime API
        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
    headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
    }
});

        let streamSid = null;
let mediaCount = 0;

        // Configure the OpenAI session once it's open
        const initializeSession = () => {
            const sessionUpdate = {
    type: 'session.update',
    session: {
        type: 'realtime',
        instructions: SYSTEM_MESSAGE,
        audio: {
    input: {
        format: { type: 'audio/pcmu' },
        turn_detection: {
  type: 'server_vad',
  threshold: 0.6,
  prefix_padding_ms: 300,
  silence_duration_ms: 800,
  create_response: true,
  interrupt_response: true
}
    },
    output: {
        format: { type: 'audio/pcmu' },
        voice: VOICE
    }
},
        tools: [
            {
                type: 'function',
                name: 'save_lead',
                description: 'Save the captured caller details once the caller has confirmed them. Call this exactly once, near the end of the call, after all fields are collected and confirmed.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: "Caller's full name" },
                        address: { type: 'string', description: 'Service address for the job' },
                        problem: {
                            type: 'string',
                            enum: ['AC out', 'no heat', 'install quote', 'maintenance'],
                            description: 'The problem category'
                        },
                        urgency: {
                            type: 'string',
                            enum: ['emergency', 'same day', 'this week', 'flexible'],
                            description: 'How urgent the job is'
                        },
                        callback_number: { type: 'string', description: 'Best callback phone number' }
                    },
                    required: ['name', 'address', 'problem', 'urgency', 'callback_number']
                }
            }
        ],
        tool_choice: 'auto'
    }
};
            console.log('Sending session update to OpenAI');
            openAiWs.send(JSON.stringify(sessionUpdate));

            // Make the AI greet first
setTimeout(() => {
  openAiWs.send(JSON.stringify({
    type: 'response.create',
    response: {
      instructions: 'Greet the caller warmly. Say something like: "Thanks for calling, this is the after-hours line. How can I help you today?" Then wait for their response.'
    }
  }));
}, 500);
        };

        // When OpenAI's WebSocket opens
        openAiWs.on('open', () => {
            console.log('Connected to OpenAI Realtime API');
            setTimeout(initializeSession, 250);
        });

        // When OpenAI sends us a message (audio chunk, transcript, etc.)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (!response.type.includes('audio.delta') && !response.type.includes('audio_transcript.delta')) {
                    console.log('OpenAI event:', response.type);
                }

                if (response.type === 'response.output_audio.delta' && response.delta) {
                    // OpenAI sent us audio - forward it to Twilio
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: response.delta }
                    };
                    connection.send(JSON.stringify(audioDelta));
                }

                // The model finished collecting details and called save_lead
                if (response.type === 'response.function_call_arguments.done' && response.name === 'save_lead') {
                    let lead = {};
                    try {
                        lead = JSON.parse(response.arguments || '{}');
                    } catch (parseErr) {
                        console.error('Could not parse save_lead arguments:', response.arguments);
                    }
                    console.log('Captured lead:', lead);

                    // Forward to n8n (which writes the Google Sheet row + sends the SMS confirmation)
                    forwardLead(lead);

                    // Tell the model the lead was saved so it can confirm to the caller
                    openAiWs.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: response.call_id,
                            output: JSON.stringify({ status: 'saved' })
                        }
                    }));
                    openAiWs.send(JSON.stringify({ type: 'response.create' }));
                }

                if (response.type === 'error') {
                    console.error('OpenAI error:', response);
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error);
            }
        });

        // When Twilio sends us a message (audio from the caller, or events)
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Stream started:', streamSid);
                        break;
                    case 'media':
                    mediaCount = (mediaCount || 0) + 1;
                    if (mediaCount % 100 === 0) console.log(`Received ${mediaCount} media chunks from Twilio`);
                    if (openAiWs.readyState === WebSocket.OPEN) {
                        const audioAppend = {
                            type: 'input_audio_buffer.append',
                            audio: data.media.payload
                        };
                        openAiWs.send(JSON.stringify(audioAppend));
                    }
                    break;
                    case 'stop':
                        console.log('Stream stopped');
                        break;
                }
            } catch (error) {
                console.error('Error processing Twilio message:', error);
            }
        });

        // Cleanup when Twilio disconnects
        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log('Twilio client disconnected');
        });

        // Cleanup when OpenAI disconnects
        openAiWs.on('close', () => {
            console.log('Disconnected from OpenAI');
        });

        openAiWs.on('error', (error) => {
            console.error('OpenAI WebSocket error:', error);
        });
    });
});
fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});