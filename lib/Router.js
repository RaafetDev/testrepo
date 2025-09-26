var http = require('http');
var url = require('url');
var tldjs = require('tldjs');
var httpProxy = require('http-proxy');

function Router(tunnels, pathPrefix) {
    if (!(this instanceof Router)) {
        return new Router(tunnels, pathPrefix);
    }

    this._tunnels = tunnels;
    this._pathPrefix = pathPrefix || ''; // Store path prefix
    this._proxy = httpProxy.createProxyServer({
        target: {
            host: '127.0.0.1', // Default, will be overridden
            port: 0
        }
    });

    // handle proxy errors
    this._proxy.on('error', function(err, req, res) {
        res.writeHead(500);
        res.end('proxy error: ' + err.message);
    });
}

Router.prototype._bounce = function(req, res) {
    res.writeHead(302, {
        Location: 'https://github.com/localtunnel/localtunnel'
    });
    res.end();
};

Router.prototype._tunnel_info = function(id, req, res) {
    var tunnel = this._tunnels.get(id);
    if (!tunnel) {
        res.writeHead(404);
        res.end('tunnel not found');
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        id: tunnel.id,
        url: tunnel.url,
        port: tunnel.port
    }));
};

Router.prototype._new_tunnel = function(req, res) {
    var self = this;

    var body = '';
    req.on('data', function(data) {
        body += data;
    });

    req.on('end', function() {
        try {
            body = JSON.parse(body);
        } catch (e) {
            res.writeHead(400);
            res.end('invalid json');
            return;
        }

        var clientname = body.clientname;

        self._tunnels.parent.new_tunnel(clientname, function(err, tunnel) {
            if (err) {
                res.writeHead(500);
                res.end('error creating tunnel');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: tunnel.id,
                url: tunnel.url,
                port: tunnel.port
            }));
        });
    });
};

Router.prototype._maybe_bounce = function(req, res) {
    var hostname = req.headers.host ? req.headers.host.split(':')[0] : '';
    var pathname = url.parse(req.url).pathname;

    // Path-based routing
    if (this._pathPrefix && pathname.startsWith('/' + this._pathPrefix + '/')) {
        var pathParts = pathname.split('/');
        if (pathParts.length >= 3) {
            var tunnelName = pathParts[2]; // e.g., /tunnel/randomsub/ -> 'randomsub'
            var tunnel = this._tunnels.get(tunnelName);
            if (tunnel && tunnel.port) {
                // Rewrite URL to strip prefix
                var prefixLen = ('/' + this._pathPrefix + '/' + tunnelName + '/').length;
                req.url = '/' + pathname.slice(prefixLen) + (url.parse(req.url).search || '');
                if (req.url === '/') req.url = ''; // Handle exact match
                // Proxy to tunnel
                this._proxy.web(req, res, {
                    target: {
                        host: '127.0.0.1',
                        port: tunnel.port
                    }
                });
                return true;
            }
        }
        // Invalid tunnel path
        this._bounce(req, res);
        return true;
    }

    // Original subdomain-based routing
    var subdomain = tldjs.getSubdomain(hostname);
    if (!subdomain) {
        return false;
    }

    var tunnel = this._tunnels.get(subdomain);
    if (!tunnel || !tunnel.port) {
        this._bounce(req, res);
        return true;
    }

    this._proxy.web(req, res, {
        target: {
            host: '127.0.0.1',
            port: tunnel.port
        }
    });
    return true;
};

Router.prototype.dispatch = function(req, res) {
    var self = this;

    // handle api calls
    var pathname = url.parse(req.url).pathname;

    if (pathname === '/api/tunnels' && req.method === 'POST') {
        return this._new_tunnel(req, res);
    }

    if (pathname.match(/^\/api\/tunnels\/(.+)$/)) {
        var id = pathname.match(/^\/api\/tunnels\/(.+)$/)[1];
        return this._tunnel_info(id, req, res);
    }

    if (req.url === '/?new') {
        return this._new_tunnel(req, res);
    }

    var m = req.url.match(/^\/(.+)/);
    if (m && req.url !== '/robots.txt') {
        return this._tunnel_info(m[1], req, res);
    }

    // bounce or proxy
    if (!this._maybe_bounce(req, res)) {
        this._bounce(req, res);
    }
};

module.exports = Router;
