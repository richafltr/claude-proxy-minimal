const express = require('express');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration
const CONFIG = {
    GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || 'gen-lang-client-0465895437',
    GOOGLE_LOCATION: process.env.GOOGLE_LOCATION || 'us-east5',
    ENDPOINT: 'us-east5-aiplatform.googleapis.com'
};

// In-memory token cache
let authCache = {
    token: null,
    expiry: 0
};

// Initialize Google Auth
let googleAuth;

async function initializeGoogleAuth() {
    try {
        const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        
        if (serviceAccountJson) {
            console.log('🔑 Attempting to use service account from environment...');
            
            // DigitalOcean encrypts secrets with EV[1:...] format, which isn't standard base64
            // Try multiple decoding strategies
            let credentials = null;
            
            try {
                // Strategy 1: Try direct JSON parse (if it's already plain JSON)
                credentials = JSON.parse(serviceAccountJson);
                console.log('✅ Parsed as direct JSON');
            } catch (e1) {
                try {
                    // Strategy 2: Try base64 decode
                    const decoded = Buffer.from(serviceAccountJson, 'base64').toString('utf-8');
                    credentials = JSON.parse(decoded);
                    console.log('✅ Decoded from base64');
                } catch (e2) {
                    console.log('⚠️ Could not parse service account JSON. Using default auth.');
                    console.log('   Direct parse error:', e1.message.substring(0, 100));
                    console.log('   Base64 parse error:', e2.message.substring(0, 100));
                }
            }
            
            if (credentials && credentials.type === 'service_account') {
                googleAuth = new GoogleAuth({
                    credentials: credentials,
                    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                    projectId: CONFIG.GOOGLE_PROJECT_ID
                });
                console.log(`✅ Service account loaded: ${credentials.client_email}`);
            } else {
                console.log('⚠️ Invalid credentials format, using default auth');
                googleAuth = new GoogleAuth({
                    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                    projectId: CONFIG.GOOGLE_PROJECT_ID
                });
            }
        } else {
            console.log('🔑 Using default Google Auth (no service account provided)');
            googleAuth = new GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                projectId: CONFIG.GOOGLE_PROJECT_ID
            });
        }
        
        console.log('✅ Google Auth initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize Google Auth:', error.message);
        return false;
    }
}

// Get auth token with caching
async function getAuthToken() {
    const now = Date.now();
    
    // Return cached token if still valid (with 5min buffer)
    if (authCache.token && now < (authCache.expiry - 300000)) {
        return authCache.token;
    }
    
    try {
        const client = await googleAuth.getClient();
        const accessToken = await client.getAccessToken();
        
        if (accessToken.token) {
            authCache.token = accessToken.token;
            // Tokens typically expire in 1 hour
            authCache.expiry = now + (55 * 60 * 1000); // 55 minutes
            console.log('✅ Got fresh auth token');
            return accessToken.token;
        } else {
            throw new Error('No access token received');
        }
    } catch (error) {
        console.error('❌ Failed to get auth token:', error.message);
        throw error;
    }
}

// Model mapping
const MODEL_MAP = {
    'claude-4-opus': 'claude-sonnet-4',
    'claude-4-sonnet': 'claude-sonnet-4', 
    'claude-4': 'claude-sonnet-4',
    'claude-sonnet-4': 'claude-sonnet-4',
    'claude-3.7-sonnet': 'claude-3-7-sonnet',
    'claude-3-7-sonnet': 'claude-3-7-sonnet',
    'gpt-4': 'claude-sonnet-4',
    'gpt-4-turbo': 'claude-sonnet-4'
};

// Middleware
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'claude-proxy-minimal',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Claude Proxy Server - Minimal',
        endpoints: {
            health: '/health',
            chat: '/v1/chat/completions'
        },
        models: Object.keys(MODEL_MAP)
    });
});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { model, messages, max_tokens = 4096, temperature = 0.7, stream = false } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Invalid messages format' });
        }
        
        // Map model name
        const claudeModel = MODEL_MAP[model] || 'claude-sonnet-4';
        
        console.log(`🤖 Request: ${model} -> ${claudeModel}, ${messages.length} messages`);
        
        // Get auth token
        const token = await getAuthToken();
        
        // Prepare request for Google Cloud Vertex AI
        const vertexPayload = {
            anthropic_version: "vertex-2023-10-16",
            max_tokens: Math.min(max_tokens, 8192),
            temperature: Math.max(0, Math.min(1, temperature)),
            messages: messages.map(msg => ({
                role: msg.role,
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }))
        };
        
        const vertexUrl = `https://${CONFIG.ENDPOINT}/v1/projects/${CONFIG.GOOGLE_PROJECT_ID}/locations/${CONFIG.GOOGLE_LOCATION}/publishers/anthropic/models/${claudeModel}:rawPredict`;
        
        // Call Google Cloud Vertex AI
        const response = await axios.post(vertexUrl, vertexPayload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        
        // Convert to OpenAI format
        const claudeResponse = response.data;
        const openaiResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: claudeResponse.content?.[0]?.text || 'No response generated'
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: claudeResponse.usage?.input_tokens || 0,
                completion_tokens: claudeResponse.usage?.output_tokens || 0,
                total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0)
            }
        };
        
        console.log(`✅ Success: ${openaiResponse.usage.total_tokens} tokens`);
        res.json(openaiResponse);
        
    } catch (error) {
        console.error('❌ Chat completion error:', error.message);
        
        if (error.response?.status === 401) {
            // Clear auth cache on 401
            authCache.token = null;
            authCache.expiry = 0;
        }
        
        res.status(500).json({
            error: {
                message: `Claude proxy error: ${error.message}`,
                type: 'proxy_error',
                code: error.response?.status || 500
            }
        });
    }
});

// Start server
async function startServer() {
    const authInitialized = await initializeGoogleAuth();
    
    if (!authInitialized) {
        console.log('⚠️ Google Auth not properly initialized, but starting server anyway');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Claude Proxy Server running on port ${PORT}`);
        console.log(`📍 Google Cloud: ${CONFIG.GOOGLE_PROJECT_ID} (${CONFIG.GOOGLE_LOCATION})`);
        console.log(`🤖 Models: ${Object.keys(MODEL_MAP).join(', ')}`);
    });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    process.exit(0);
});

startServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});
