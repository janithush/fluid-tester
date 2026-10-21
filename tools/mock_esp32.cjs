// tools/mock_esp32.cjs
// Zero-dependency ESP32-S3 Mock Server (Serves web/dist + /ws WebSocket stream)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 4173;
const DIST_DIR = path.resolve(__dirname, '../web/dist');

// Common MIME types for serving Vite build assets
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Initial telemetry state matching ESP32 firmware wire contract
let telemetry = {
  brake_oil: {
    moisture: "1.2%",
    status: "NORMAL"
  },
  engine_oil: {
    dielectric: 2.18,
    capacitance: 4.15,
    water: "NO",
    tbn: null,
    tan: null,
    viscosity: null,
    status: "EXCELLENT"
  },
  coolant: {
    ph: null,
    status: "NO_DATA"
  }
};

const clients = new Set();

// Send unmasked WebSocket frame from server to client (RFC 6455)
function sendWsFrame(socket, payloadStr) {
  const payload = Buffer.from(payloadStr, 'utf8');
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  try {
    socket.write(Buffer.concat([header, payload]));
  } catch (err) {
    clients.delete(socket);
  }
}

// 1. HTTP Server for Static Files + REST Endpoint
const server = http.createServer((req, res) => {
  // CORS Headers matching ESP32 addCorsHeaders()
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle /api/data HTTP endpoint
  if (req.url === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(telemetry));
    return;
  }

  // Serve static files from web/dist
  let cleanUrl = req.url.split('?')[0];
  let filePath = path.join(DIST_DIR, cleanUrl === '/' ? 'index.html' : cleanUrl);

  // SPA fallback to index.html if file doesn't exist
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading ' + cleanUrl);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// 2. WebSocket Upgrade Handler (/ws)
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  clients.add(socket);
  console.log(`[ESP32 SIMULATOR] Dashboard connected! (Active clients: ${clients.size})`);

  // Immediate snapshot on connect (matches main.ino WS_EVT_CONNECT behavior)
  sendWsFrame(socket, JSON.stringify({
    kind: 'snapshot',
    data: telemetry
  }));

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[ESP32 SIMULATOR] Dashboard disconnected. (Active clients: ${clients.size})`);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

// 3. Periodic Telemetry Stream & Heartbeat (matches ESP32 streamTickMs loop)
setInterval(() => {
  if (clients.size === 0) return;

  // Simulate subtle real-world sensor fluctuations
  const dDelta = (Math.random() * 0.04 - 0.02);
  const cDelta = (Math.random() * 0.06 - 0.03);

  telemetry.engine_oil.dielectric = +(2.18 + dDelta).toFixed(2);
  telemetry.engine_oil.capacitance = +(4.15 + cDelta).toFixed(2);

  const snapshotPayload = JSON.stringify({
    kind: 'snapshot',
    data: telemetry
  });

  const heartbeatPayload = JSON.stringify({
    kind: 'heartbeat',
    ts: Date.now()
  });

  for (const client of clients) {
    sendWsFrame(client, snapshotPayload);
    sendWsFrame(client, heartbeatPayload);
  }
}, 1000);

// Start server
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  FLOWMETRICS - ESP32-S3 MOCK SIMULATOR RUNNING   `);
  console.log(`==================================================`);
  console.log(`> Local Web URL : http://localhost:${PORT}`);
  console.log(`> WebSocket Bus : ws://localhost:${PORT}/ws`);
  console.log(`> HTTP Data API : http://localhost:${PORT}/api/data`);
  console.log(`\nServing build from: ${DIST_DIR}`);
  console.log(`Press Ctrl+C to stop.\n`);
});