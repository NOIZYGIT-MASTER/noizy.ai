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

// ---------------------------------------------------------------------------
// LUCY TOUCH — embedded iPad dashboard, served at GET /
// Open http://<GOD-ip-or-tailnet-100.x>:7006/ on the iPad. No CORS needed:
// the page and the API share one origin. Add to Home Screen for app mode.
// ---------------------------------------------------------------------------
const LUCY_TOUCH_HTML = [
'<!DOCTYPE html>',
'<html lang="en"><head>',
'<meta charset="utf-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
'<meta name="apple-mobile-web-app-capable" content="yes">',
'<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
'<title>LUCY TOUCH — Dreamchamber</title>',
'<style>',
':root{--bg:#0b0b10;--panel:#15151f;--text:#f2f2f7;--dim:#8e8e99;--live:#30d158;--rec:#ff453a;--warn:#ffd60a;--accent:#bf5af2}',
'*{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent}',
'body{background:var(--bg);color:var(--text);font-family:-apple-system,"SF Pro Display",Helvetica,Arial,sans-serif;min-height:100vh;padding:max(20px,env(safe-area-inset-top)) 20px 20px}',
'h1{font-size:28px;letter-spacing:.5px}h1 span{color:var(--accent)}',
'.sub{color:var(--dim);font-size:13px;margin-top:2px}',
'.badge{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:999px;font-weight:700;font-size:15px;letter-spacing:1px}',
'.badge.live{background:rgba(48,209,88,.15);color:var(--live)}',
'.badge.rec{background:rgba(255,69,58,.18);color:var(--rec);animation:pulse 1.2s infinite}',
'.badge.down{background:rgba(255,214,10,.15);color:var(--warn)}',
'@keyframes pulse{50%{opacity:.55}}',
'.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:22px 0}',
'button{border:0;border-radius:18px;padding:26px 10px;font-size:19px;font-weight:700;color:var(--text);background:var(--panel);cursor:pointer}',
'button:active{transform:scale(.97)}button:disabled{opacity:.4}',
'#bRecord{background:linear-gradient(135deg,#3a0d0d,#200)}#bRecord .ic{color:var(--rec)}',
'#bArm .ic{color:var(--warn)}#bSave .ic{color:#0a84ff}#bStop .ic{color:var(--dim)}',
'.ic{display:block;font-size:30px;margin-bottom:8px}',
'.panel{background:var(--panel);border-radius:18px;padding:16px;margin-top:14px}',
'.kv{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #22222e;font-size:15px}',
'.kv:last-child{border-bottom:0}.kv b{color:var(--dim);font-weight:500}',
'#log{font:12px ui-monospace,Menlo,monospace;color:var(--dim);white-space:pre-wrap;max-height:160px;overflow-y:auto}',
'footer{margin-top:18px;color:var(--dim);font-size:11px;text-align:center}',
'</style></head><body>',
'<h1>LUCY <span>TOUCH</span></h1>',
'<div class="sub">ENGR_KEITH live telemetry \u00b7 Dreamchamber transport</div>',
'<div id="badge" class="badge down">CONNECTING\u2026</div>',
'<div class="grid">',
'<button id="bRecord"><span class="ic">\u25cf</span>Record</button>',
'<button id="bStop"><span class="ic">\u25a0</span>Stop</button>',
'<button id="bArm"><span class="ic">\ud83c\udf99</span>Arm</button>',
'<button id="bSave"><span class="ic">\u2193</span>Save</button>',
'</div>',
'<div class="panel">',
'<div class="kv"><b>Session</b><span id="vSession">\u2014</span></div>',
'<div class="kv"><b>Transport</b><span id="vStatus">\u2014</span></div>',
'<div class="kv"><b>Armed</b><span id="vArmed">\u2014</span></div>',
'<div class="kv"><b>Neumann chain</b><span id="vChain">\u2014</span></div>',
'<div class="kv"><b>Last command</b><span id="vLast">\u2014</span></div>',
'<div class="kv"><b>Updated</b><span id="vTime">\u2014</span></div>',
'</div>',
'<div class="panel"><div id="log">LUCY TOUCH ready.</div></div>',
'<footer>Created &amp; Loved Into Being by NOIZYLAB.CA \u00b7 GORUNFREE</footer>',
'<script>',
'(function(){',
'var logEl=document.getElementById("log");',
'function log(m){logEl.textContent=new Date().toLocaleTimeString()+"  "+m+"\\n"+logEl.textContent.slice(0,4000);}',
'function set(id,v){document.getElementById(id).textContent=v;}',
'function paint(s){',
'var b=document.getElementById("badge");',
'if(s.recording){b.className="badge rec";b.textContent="\u25cf RECORDING";}',
'else if(s.signalChainLive){b.className="badge live";b.textContent="CHAIN LIVE";}',
'else{b.className="badge down";b.textContent="CHAIN DOWN";}',
'set("vSession",s.session||"\u2014");set("vStatus",s.status||"\u2014");',
'set("vArmed",s.armed?"YES":"no");set("vChain",s.signalChainLive?"LIVE":"DOWN");',
'set("vLast",(s.lastCmd||"\u2014")+(s.lastTime?" @ "+s.lastTime.slice(11,19):""));',
'set("vTime",new Date().toLocaleTimeString());',
'}',
'function poll(){fetch("/status").then(function(r){return r.json();}).then(paint)',
'.catch(function(){var b=document.getElementById("badge");b.className="badge down";b.textContent="KEITH OFFLINE";});}',
'function dispatch(cmd){',
'log("\u2192 "+cmd.toUpperCase());',
'fetch("/dispatch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:cmd})})',
'.then(function(r){return r.json();})',
'.then(function(d){if(d.error){log("ABORT: "+(d.msg||d.error));}else{log(cmd.toUpperCase()+" \u2192 "+(d.status||"OK"));paint(d);}})',
'.catch(function(e){log("FAIL: "+e.message);});',
'}',
'[["bRecord","record"],["bStop","stop"],["bArm","arm"],["bSave","save"]].forEach(function(p){',
'document.getElementById(p[0]).addEventListener("click",function(){dispatch(p[1]);});});',
'poll();setInterval(poll,2000);',
'})();',
'</script></body></html>'
].join('\n');

const server = http.createServer(async (req, res) => {
    // CORS: allow external dashboards/tools on other origins to read state.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

    // LUCY TOUCH dashboard (same-origin UI for iPad / any browser on the mesh)
    if (req.method === 'GET' && (req.url === '/' || req.url === '/lucy' || req.url === '/lucy-touch')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(LUCY_TOUCH_HTML);
    }

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
    log(`ENGR_KEITH v3.2 ONLINE — port ${PORT} (NOIZYNET gate on ${NOIZYNET_PORT}; LUCY TOUCH at /)`);
});
