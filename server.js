const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');

// Configuration
const PORT = process.env.PORT || $PORT;
const MAX_SOCKETS = process.env.MAX_SOCKETS || 10;

// Store active tunnels and connections
const tunnels = new Map(); // tunnelId -> { id, port, sockets: Set, createdAt }
const activeSockets = new Map(); // socket -> tunnelId

// Generate unique tunnel ID
function generateTunnelId() {
  return crypto.randomBytes(16).toString('hex');
}

// Generate shorter readable ID for URLs
function generateShortId() {
  const adjectives = ['quick', 'lazy', 'sleepy', 'noisy', 'hungry', 'crazy', 'happy', 'angry', 'brave', 'calm'];
  const animals = ['fox', 'dog', 'cat', 'bear', 'lion', 'tiger', 'eagle', 'shark', 'whale', 'wolf'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${animal}-${num}`;
}

// Cleanup old tunnels (older than 1 hour)
function cleanupOldTunnels() {
  const oneHour = 60 * 60 * 1000;
  const now = Date.now();
  
  for (const [tunnelId, tunnel] of tunnels.entries()) {
    if (now - tunnel.createdAt > oneHour) {
      console.log(`Cleaning up old tunnel: ${tunnelId}`);
      // Close all sockets for this tunnel
      tunnel.sockets.forEach(socket => {
        socket.destroy();
        activeSockets.delete(socket);
      });
      tunnels.delete(tunnelId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldTunnels, 10 * 60 * 1000);

// TCP Server for tunnel connections
const tcpServer = net.createServer((socket) => {
  console.log('New TCP connection from client');
  
  let tunnelId = null;
  let isAuthenticated = false;
  
  socket.on('data', (data) => {
    if (!isAuthenticated) {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'auth' && message.tunnelId) {
          tunnelId = message.tunnelId;
          const tunnel = tunnels.get(tunnelId);
          
          if (tunnel) {
            isAuthenticated = true;
            tunnel.sockets.add(socket);
            activeSockets.set(socket, tunnelId);
            
            socket.write(JSON.stringify({
              type: 'auth-ok',
              tunnelId: tunnelId
            }));
            
            console.log(`Client authenticated for tunnel: ${tunnelId}`);
          } else {
            socket.write(JSON.stringify({
              type: 'auth-failed',
              message: 'Invalid tunnel ID'
            }));
            socket.destroy();
          }
        } else {
          socket.destroy();
        }
      } catch (err) {
        console.error('Failed to parse auth message:', err);
        socket.destroy();
      }
    }
  });
  
  socket.on('error', (err) => {
    console.error('TCP socket error:', err);
    cleanup();
  });
  
  socket.on('close', () => {
    console.log('TCP connection closed');
    cleanup();
  });
  
  function cleanup() {
    if (tunnelId && activeSockets.has(socket)) {
      const tunnel = tunnels.get(tunnelId);
      if (tunnel) {
        tunnel.sockets.delete(socket);
        if (tunnel.sockets.size === 0) {
          console.log(`No more connections for tunnel ${tunnelId}, keeping alive for potential reconnection`);
        }
      }
      activeSockets.delete(socket);
    }
  }
});

// HTTP Server for API and proxying
const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // API endpoints
  if (url.pathname === '/api/tunnels' && req.method === 'POST') {
    handleCreateTunnel(req, res);
    return;
  }
  
  if (url.pathname === '/api/status') {
    handleStatus(req, res);
    return;
  }
  
  if (url.pathname === '/api/tunnels' && req.method === 'GET') {
    handleListTunnels(req, res);
    return;
  }
  
  // Check if this is a tunnel request (path format: /t/{tunnelId}/*)
  const pathMatch = url.pathname.match(/^\/t\/([^\/]+)(.*)$/);
  if (pathMatch) {
    const tunnelId = pathMatch[1];
    const targetPath = pathMatch[2] || '/';
    await handleTunnelRequest(req, res, tunnelId, targetPath);
    return;
  }
  
  // Default response
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Custom LocalTunnel Server',
      version: '1.0.0',
      tunnels: tunnels.size,
      uptime: process.uptime(),
      usage: 'POST /api/tunnels to create tunnel, access via /t/{tunnelId}/'
    }));
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Handle tunnel creation
function handleCreateTunnel(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      const tunnelId = data.subdomain || generateShortId();
      const port = parseInt(data.port) || Math.floor(Math.random() * 10000) + 20000;
      
      // Check if tunnel ID already exists
      if (tunnels.has(tunnelId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tunnel ID already exists' }));
        return;
      }
      
      // Create tunnel
      const tunnel = {
        id: tunnelId,
        port: port,
        sockets: new Set(),
        createdAt: Date.now()
      };
      
      tunnels.set(tunnelId, tunnel);
      
      const host = req.headers.host || 'localhost:3000';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: tunnelId,
        url: `${protocol}://${host}/t/${tunnelId}`,
        port: port,
        max_conn_count: MAX_SOCKETS,
        message: `Connect your client to port ${port} with tunnel ID: ${tunnelId}`
      }));
      
      console.log(`Created tunnel: ${tunnelId} on port ${port}`);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

// Handle status request
function handleStatus(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    tunnels: tunnels.size,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  }));
}

// Handle list tunnels
function handleListTunnels(req, res) {
  const tunnelList = Array.from(tunnels.entries()).map(([id, tunnel]) => ({
    id,
    port: tunnel.port,
    connections: tunnel.sockets.size,
    created: new Date(tunnel.createdAt).toISOString()
  }));
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tunnels: tunnelList }));
}

// Handle tunnel requests (proxy to client)
async function handleTunnelRequest(req, res, tunnelId, targetPath) {
  const tunnel = tunnels.get(tunnelId);
  
  if (!tunnel) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Tunnel ${tunnelId} not found` }));
    return;
  }
  
  if (tunnel.sockets.size === 0) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Tunnel ${tunnelId} has no active connections` }));
    return;
  }
  
  // Get a socket (simple round-robin)
  const sockets = Array.from(tunnel.sockets);
  const socket = sockets[Math.floor(Math.random() * sockets.length)];
  
  if (!socket || socket.destroyed) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No healthy tunnel connection available' }));
    return;
  }
  
  try {
    // Forward the request
    await forwardRequest(req, res, socket, targetPath);
  } catch (err) {
    console.error('Error forwarding request:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

// Forward HTTP request through tunnel
function forwardRequest(req, res, socket, targetPath) {
  return new Promise((resolve, reject) => {
    let responseStarted = false;
    let requestData = '';
    
    // Collect request body
    req.on('data', chunk => requestData += chunk);
    req.on('end', () => {
      // Build HTTP request
      const headers = Object.keys(req.headers)
        .map(key => `${key}: ${req.headers[key]}`)
        .join('\r\n');
      
      const httpRequest = [
        `${req.method} ${targetPath}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''} HTTP/1.1`,
        headers,
        '',
        requestData
      ].join('\r\n');
      
      // Send request through tunnel
      const requestMessage = JSON.stringify({
        type: 'http-request',
        data: httpRequest
      }) + '\n';
      
      socket.write(requestMessage);
    });
    
    // Handle response from client
    const originalOnData = socket.listeners('data');
    const responseHandler = (data) => {
      if (!responseStarted) {
        try {
          const lines = data.toString().split('\r\n');
          const message = JSON.parse(lines[0]);
          
          if (message.type === 'http-response') {
            responseStarted = true;
            const response = message.data;
            
            // Parse HTTP response
            const [statusLine, ...headerLines] = response.split('\r\n');
            const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+)/);
            const statusCode = statusMatch ? parseInt(statusMatch[1]) : 200;
            
            // Extract headers and body
            let bodyStart = response.indexOf('\r\n\r\n');
            if (bodyStart === -1) bodyStart = response.length;
            
            const headerSection = response.substring(response.indexOf('\r\n') + 2, bodyStart);
            const body = response.substring(bodyStart + 4);
            
            // Set response headers
            const headers = {};
            headerSection.split('\r\n').forEach(line => {
              const [key, ...valueParts] = line.split(':');
              if (key && valueParts.length) {
                headers[key.toLowerCase()] = valueParts.join(':').trim();
              }
            });
            
            res.writeHead(statusCode, headers);
            res.end(body);
            resolve();
          }
        } catch (err) {
          if (!responseStarted) {
            reject(err);
          }
        }
      }
    };
    
    socket.on('data', responseHandler);
    
    // Cleanup
    const cleanup = () => {
      socket.removeListener('data', responseHandler);
    };
    
    res.on('close', cleanup);
    res.on('finish', cleanup);
    
    // Timeout
    setTimeout(() => {
      if (!responseStarted) {
        cleanup();
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
}

// Start servers
tcpServer.listen(PORT + 1, () => {
  console.log(`TCP server listening on port ${PORT + 1}`);
});

httpServer.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api/tunnels`);
  console.log(`Tunnel format: http://localhost:${PORT}/t/{tunnelId}/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  tcpServer.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  tcpServer.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

module.exports = { httpServer, tcpServer };
