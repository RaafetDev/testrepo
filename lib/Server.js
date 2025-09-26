var http = require('http');
var Router = require('./Router');
var Tunnel = require('./Tunnel');
var url = require('url');
var assert = require('assert');

function Server(port, opts) {
    if (!(this instanceof Server)) {
        return new Server(port, opts);
    }

    assert(typeof port === 'number', 'port must be a number');
    opts = opts || {};

    this._domain = opts.domain;
    this._pathPrefix = opts.pathPrefix || ''; // New path prefix option
    this._secure = !!opts.secure;
    this._max_tcp_sockets = opts.max_tcp_sockets || 10;
    this._tunnels = new Map();

    // create http server
    var router = new Router(this._tunnels, this._pathPrefix); // Pass pathPrefix
    this._http_server = http.createServer(function(req, res) {
        router.dispatch(req, res);
    });
}

Server.prototype.listen = function(address, port, callback) {
    this._http_server.listen(port, address, callback);
};

Server.prototype.address = function() {
    return this._http_server.address();
};

Server.prototype.close = function(callback) {
    // close all tunnels
    var self = this;
    var tunnels = Array.from(this._tunnels.values());
    var count = tunnels.length;

    if (count === 0) {
        self._http_server.close(callback);
        return;
    }

    tunnels.forEach(function(tunnel) {
        tunnel.close(function() {
            if (--count === 0) {
                self._http_server.close(callback);
            }
        });
    });
};

Server.prototype.generate_id = function() {
    return Math.floor(Math.random() * 100000).toString();
};

Server.prototype.new_tunnel = function(clientname, opts, callback) {
    var self = this;

    if (typeof opts !== 'object') {
        callback = opts;
        opts = {};
    }

    var id = clientname || this.generate_id();

    // make sure id is unique
    while (this._tunnels.has(id)) {
        id = this.generate_id();
    }

    var base_url = 'http' + (this._secure ? 's' : '') + '://' + this._domain;
    if (this._http_server.address()) {
        base_url += ':' + this._http_server.address().port;
    }

    // Construct URL based on pathPrefix or subdomain
    var url;
    if (this._pathPrefix) {
        url = base_url + '/' + this._pathPrefix + '/' + id + '/';
    } else {
        url = 'http' + (this._secure ? 's' : '') + '://' + id + '.' + this._domain;
        if (this._http_server.address()) {
            url += ':' + this._http_server.address().port;
        }
    }

    var tunnel = new Tunnel(id, {
        max_tcp_sockets: this._max_tcp_sockets,
        url: url
    });

    this._tunnels.set(id, tunnel);

    // cleanup tunnel on close
    tunnel.once('close', function() {
        self._tunnels.delete(id);
    });

    callback(null, tunnel);
};

module.exports = Server;
