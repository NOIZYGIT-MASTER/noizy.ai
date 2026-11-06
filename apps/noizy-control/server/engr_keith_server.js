#!/usr/bin/env node
/**
 * ENGR_KEITH v3.1 — Logic Pro transport server for the NOIZY Dreamchamber.
 *
 * New in v3.1 (App Intent support):
 *   - GET  /status     granular state for Siri / NOIZY Control dashboard
 *   - POST /dispatch   JSON command dispatch ({ "command": "record" | ... })
 *   - Pre-flight NOIZYNET health gate: record is refused unless the
 *     noizynet_daemon (port 9699) reports the signal chain live.
 *   - 'arm' transport command.
 *
 * Deploy on the GOD machine (M2 Ultra):
 *   node engr_keith_server.js
 */
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 7006;
const NOIZYNET_PORT = 9699; // noizynet_daemon health check
const AGENT = 'ENGR_KEITH';
const SCRIPT = path.join(process.env.HOME, 'Desktop', 'noizy_logic_control.applescript');
const LOG = path.join(process.env.HOME, 'Desktop', 'noizy_session_log.txt');

const COMMANDS = new Set(['record', 'stop', 'arm', 'save', 'status', 'ping']);

const state = {
    agent: AGENT,
    status: 'ONLINE',
    session: 'NOIZY Claude Session 1',
    recording: false,
    armed: false,
    signalChainLive: false,
    boot: new Date().toISOString(),
    lastCmd: null,
    lastTime: null
};

function log(m) {
    const line = `[${new Date().toISOString()}] [${AGENT}] ${m}`;
    console.log(line);
    try { fs.appendFileSync(LOG, line + '\n'); } catch (_) { /* log file optional */ }
}

/** Pre-flight health check for the Neumann chain via noizynet_daemon. */
function checkSignalChain() {
    return new Promise((resolve) => {
        const req = http.get(
            { host: '127.0.0.1', port: NOIZYNET_PORT, path: '/health', timeout: 2000 },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const health = JSON.parse(data);
                        state.signalChainLive =
                            health.status === 'SIGNAL_CHAIN_LIVE' || health.aunet_port_open === true;
                    } catch (_) {
                        state.signalChainLive = false;
                    }
                    resolve(state.signalChainLive);
                });
            }
        );
        req.on('timeout', () => { req.destroy(); state.signalChainLive = false; resolve(false); });
        req.on('error', () => { state.signalChainLive = false; resolve(false); });
    });
}

/** Run a transport command through the AppleScript bridge. */
function run(cmd) {
    try {
        const r = execFileSync('osascript', [SCRIPT, cmd], { encoding: 'utf-8', timeout: 10000 }).trim();
        return { ok: true, r };
    } catch (e) {
        return { ok: false, e: e.message };
    }
}

async function handle(cmd) {
    if (!COMMANDS.has(cmd)) return { error: `Unknown command: ${cmd}` };

    log(`CMD: ${cmd}`);
    state.lastCmd = cmd;
    state.lastTime = new Date().toISOString();

    // Zero-failure gate: never roll if the Neumann chain is down.
    if (cmd === 'record') {
        const isLive = await checkSignalChain();
        if (!isLive) {
            log('ABORT: Signal chain not live.');
            return {
                error: 'SIGNAL_CHAIN_DOWN',
                msg: 'The Neumann chain is not live. Check the AU Net wire (port 9699) before recording.'
            };
        }
    }

    switch (cmd) {
        case 'record': {
            const r = run('record');
            if (r.ok) { state.recording = true; state.armed = true; state.status = 'RECORDING'; }
            return { ...state, action: r };
        }
        case 'stop': {
            const r = run('stop');
            if (r.ok) { state.recording = false; state.status = 'STOPPED'; }
            return { ...state, action: r };
        }
        case 'arm': {
            const r = run('arm');
            if (r.ok) { state.armed = true; state.status = 'ARMED'; }
            return { ...state, action: r };
        }
        case 'save': {
            const r = run('save');
            return { ...state, action: r };
        }
        case 'status': {
            await checkSignalChain();
            return state;
        }
        case 'ping':
            return { agent: AGENT, alive: true, signalChain: state.signalChainLive };
    }
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    // Siri / dashboard status endpoint
    if (req.method === 'GET' && (req.url === '/status' || req.url === '/health')) {
        const s = await handle('status');
        return res.end(JSON.stringify(s, null, 2));
    }

    // App Intent dispatch endpoint
    if (req.method === 'POST' && req.url === '/dispatch') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
            try {
                const p = JSON.parse(body || '{}');
                const result = await handle(String(p.command || p.cmd || '').toLowerCase());
                res.statusCode = result && result.error && result.error.startsWith('Unknown') ? 400 : 200;
                res.end(JSON.stringify(result, null, 2));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Legacy path-style commands: POST/GET /record, /stop, /arm, /save, /ping
    const cmd = req.url.replace(/^\//, '').toLowerCase();
    if (!COMMANDS.has(cmd)) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: `Unknown endpoint: ${req.url}` }));
    }
    const result = await handle(cmd);
    res.end(JSON.stringify(result, null, 2));
});

server.listen(PORT, '0.0.0.0', () => {
    log(`ENGR_KEITH v3.1 ONLINE — port ${PORT} (NOIZYNET gate on ${NOIZYNET_PORT})`);
});
