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
        
        if (serviceAccountJson && !serviceAccountJson.startsWith('EV[1:')) {
            console.log('🔑 Attempting to parse service account JSON...');
            console.log(`   📊 JSON length: ${serviceAccountJson.length}`);
            console.log(`   📝 First 50 chars: ${serviceAccountJson.substring(0, 50)}`);
            
            let credentials = null;
            let success = false;
            
            // Strategy 1: Direct JSON parse
            try {
                credentials = JSON.parse(serviceAccountJson);
                console.log('✅ SUCCESS: Parsed as direct JSON');
                success = true;
            } catch (e1) {
                console.log(`⚠️ Direct JSON parse failed: ${e1.message.substring(0, 100)}`);
                
                // Strategy 2: Base64 decode then parse  
                try {
                    const decoded = Buffer.from(serviceAccountJson, 'base64').toString('utf-8');
                    credentials = JSON.parse(decoded);
                    console.log('✅ SUCCESS: Decoded from base64 then parsed');
                    success = true;
                } catch (e2) {
                    console.log(`⚠️ Base64 decode failed: ${e2.message.substring(0, 100)}`);
                }
            }
            
            if (success && credentials && credentials.type === 'service_account') {
                console.log(`   📧 Client email: ${credentials.client_email}`);
                console.log(`   🏗️ Project ID: ${credentials.project_id}`);
                
                googleAuth = new GoogleAuth({
                    credentials: credentials,
                    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                    projectId: CONFIG.GOOGLE_PROJECT_ID
                });
                console.log('✅ Service account authentication configured');
                return true;
            }
        }
        
        // Fallback to hardcoded service account (as backup)
        console.log('🔑 Trying hardcoded service account as fallback...');
        const fallbackServiceAccount = "ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAiZ2VuLWxhbmctY2xpZW50LTA0NjU4OTU0MzciLAogICJwcml2YXRlX2tleV9pZCI6ICJhNzVhZTVlYTBmZjk2ZjFiNzg5NzQzOGJmYzhkZTc4MWQzMWIyMWQ3IiwKICAicHJpdmF0ZV9rZXkiOiAiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXG5NSUlFdmdJQkFEQU5CZ2txaGtpRzl3MEJBUUVGQUFTQ0JLZ3dnZ1NrQWdFQUFvSUJBUURHbThJdUF3YVVGajJUXG42elZOUVhMeU5OSkFmQ3QxUnRSWCtSeEtnSTFHNFZvMVNqNHdOYnZYcWQ0aS8vRWdpVXVuS0swK3BsQzRkVjRyXG5XeEVuZEZhYWsxSFErSzIxRUpZUHczVFIzdjFzQ05Zb1lxVWpHSXdEbm9TZ0hJVVFtNTF2enJRVXk5NDJwUjN1XG52Mm1ET0JNUWRIVTNHVWZSTEQ2YWZaRERkOEpjamw3LytnRUczaHdhY3pQVjJyUFRhVkl0OFF3akxka01ycWwzXG5jTFpWaUx5MGVpRHVEWFlVS3NsdmZRMlp3S1Jvc0l0VG1WaEdWc1hNdHE1SjhCN1FRRzBHTjhRYzVXOWtUQTdKXG4yQUt6Zjhya2t0ZjJxUllMMHFFeHZ2aUlwek5MZm53SVdvTHo4SWpvK2o1cEF6SmI4aUl6K3lyTHVJL3dMbTBcbnpwM2JCM0R6QWdNQkFBRUNnZ0VBTkhVamZyK3gxeDlndUZjaHh2d0lma3pSVTlONEw0dTd2bGkvemp4U0d1eWVcbnhRQ05HSEs0NEtldlVwTkRmeEtFZHV4WmhmaXJ6V3pDcUxUdS9QclBmUmg0UGJmUk9jZmR1dUFuVk4rUEZCL3BcbllOVmRSTDNSRFl1ckFCZElWakNrRHNvTDZvcEdjU3gva1hYaFNwVmZBN09lMmlURlFVeHNaS1hSdks4L0dPN1NcbnBuNUNZYnZ3T1pBbWlHTkF4U0JUS0tjZkZQS01zUkMwckRSRE1NSUgxM3RZS2dVaXRqOXlVYzA5clc4ODJMMlNcbjhUL3BsZEdMdXVrUTJSVXoxMEx0c0EwM3VLWkpYL0dYY1VXVTBXL1cwNGRSTXZmNHlZbjdlZ3VBa3JuNzY1empcbmtYVm84SGZPUXJGME91WXZBejVVQzMzcERPc0hBSnZsRjNieUxUdzlrUUtCZ1FEbkFGMG1JNHVlZ0JOTWdEbU1cblBNOUg3M1ZYbVRlL0ZxSVV0R3FPeUx3QmdUejJLOXh5Y0ZkUWUwS1QzVXQxeXNoeTZVVXl6V0tyeWl6T1ZIa3BcblJiTnFGNlhZRytGVmJibTBhcWVxbHFWYVlkMGwxRGVQay82c3NaWGpuQ25YSEhqTlYvcStxelFaV3FoOHMzWHZcbnNZaUI3SXoxc0dwcVU3aG96S0VRZlp0TTlRS0JnUURjR2Z1cmlJTWVNTjBFajNrMVFZV3U2QnhLSlJORlc3QmpcbnRTTlQzMnhpekVKb1daVmN6RWxzR1R6Q3dVUDFyZEJDalYzR3k5L1JUTDBCUFU0NGNpTG9FK084bTJxbDBmXG5CbWpHdXVER3E5UXpyZjFiamU2Vk1BMlhmSEpiNVF5ZW5uZGIwRWpiNDVQRVdtQkFDS2FaUVRobHRWaVkvdk1HXG5MQTU5WWZFVlJ3S0JnR2l2WFlkZkxITFVEK3IzRDNLbk1kM2x3d1BEeCtPdFdoNlA5SXBvcGVyNHFxdlZETDQvXG44eEhpQ2pZQVg2WXVFOUVmcmVCciszOW16QTlsY05Nblp6dDVKQXRmOXlwRDQ1akRqT0JlRE9sODJEL0FnTDFzXG5rRW1xNFFhWlNzelZkbGw0dVlXWENMRkV5SDVheGVPdVRQSzBSTjFDNmJidDRmQjhhN0dSZXNQUkFvR0JBSWZXXG5wV005TWliczQwc1FQUzhvREJoaGVpd3NhNU5QdmpJYk5mMXFrNXI2RXpZUnE4UUU5SDk1cCsxT2wrSEZieFhUXG41MzlzamVxL29LcXlPM1dzbWdnM2lWNWVTZVNwaWlVK3NHV09LbkdTMUxrOGRYUU95YU5iYjlnQlh4Ymw2djd1XG5NQjRERXlSYWRQVW5EZVlYTUxLKzlNNll1R0JjWUtKN2lNQktkUjY3QW9HQkFKY3F5V0cwVUpiZmFpQVFwQ0ZBXG5raFNhaTR0WWxSVkJpNWY5UXdJelJXbzlXdDhWMG5XZlVkYTF3SkVtZEM1S212ZTR3SFh1aDJqUmRnRnR1MHFsXG5IYk44YXpOSnE3V0Z6Sm91M0RBU0NDbFRreDFRYU1RdllsVnVvQ1FqUGNXdWRpY3NDS0RqZ25QVDQYVlkJM2pYXG5rQnRjTHVYKzBSSUZOSStiRERNU0gxQmlcbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS1cbiIsCiAgImNsaWVudF9lbWFpbCI6ICJjbGF1ZGUtcHJveHktc2FAZ2VuLWxhbmctY2xpZW50LTA0NjU4OTU0MzcuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLAogICJjbGllbnRfaWQiOiAiMTExMzU0NDY1OTg0NTgyNTY3ODQ5IiwKICAiYXV0aF91cmkiOiAiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tL28vb2F1dGgyL2F1dGgiLAogICJ0b2tlbl91cmkiOiAiaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW4iLAogICJhdXRoX3Byb3ZpZGVyX3g1MDlfY2VydF91cmwiOiAiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vb2F1dGgyL3YxL2NlcnRzIiwKICAiY2xpZW50X3g1MDlfY2VydF91cmwiOiAiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vcm9ib3QvdjEvbWV0YWRhdGEveDUwOS9jbGF1ZGUtcHJveHktc2ElNDBnZW4tbGFuZy1jbGllbnQtMDQ2NTg5NTQzNy5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgInVuaXZlcnNlX2RvbWFpbiI6ICJnb29nbGVhcGlzLmNvbSIKfQo=";
        
        try {
            const fallbackCredentials = JSON.parse(Buffer.from(fallbackServiceAccount, 'base64').toString('utf-8'));
            googleAuth = new GoogleAuth({
                credentials: fallbackCredentials,
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                projectId: CONFIG.GOOGLE_PROJECT_ID
            });
            console.log('✅ Fallback service account loaded successfully');
            return true;
        } catch (fallbackError) {
            console.log('⚠️ Fallback service account also failed, using ADC');
            googleAuth = new GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                projectId: CONFIG.GOOGLE_PROJECT_ID
            });
            console.log('✅ Default Google Auth initialized');
            return true;
        }
        
    } catch (error) {
        console.error('❌ FATAL: Failed to initialize Google Auth:', error.message);
        throw error; // Don't start server if auth fails
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

// Model mapping - CORRECT GOOGLE CLOUD MODEL NAMES
const MODEL_MAP = {
    // Primary Claude models (exact Google Cloud names)
    'claude-opus-4-1': 'claude-opus-4-1',        // Claude Opus 4.1 - most powerful
    'claude-sonnet-4': 'claude-sonnet-4',        // Claude Sonnet 4 - balanced 
    'claude-3-7-sonnet': 'claude-3-7-sonnet',    // Claude 3.7 Sonnet - extended thinking
    
    // Common aliases
    'claude-4-1-opus': 'claude-opus-4-1',
    'claude-opus-4.1': 'claude-opus-4-1', 
    'claude-4-sonnet': 'claude-sonnet-4',
    'claude-sonnet-4.0': 'claude-sonnet-4',
    'claude-3.7-sonnet': 'claude-3-7-sonnet',
    'claude-sonnet-3.7': 'claude-3-7-sonnet',
    
    // OpenAI compatibility (default to Sonnet 4)
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
        version: '1.0.1',
        timestamp: new Date().toISOString(),
        build: 'force-rebuild'
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
