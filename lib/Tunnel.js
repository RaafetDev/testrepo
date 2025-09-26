var net = require('net');
var events = require('events');
var util = require('util');

function Tunnel(id, opts) {
    if (!(this instanceof Tunnel)) {
        return new Tunnel(id, opts);
    }

    events.EventEmitter.call(this);

    this.id = id;
    this.url = opts.url;
    this._max_tcp_sockets = opts.max_tcp_sockets || 10;
    this._sockets = [];
}

util.inherits(Tunnel, events.EventEmitter);

Tunnel.prototype._free_sockets = function() {
    return this._max_tcp_sockets - this._sockets.length;
};

Tunnel.prototype.get_socket = function(cb) {
    var self = this;

    if (this._sockets.length >= this._max_tcp_sockets) {
        cb(new Error('rejected: max sockets reached'));
        return;
    }

    var socket = net.createConnection({
        port: 0 // Will be assigned by server
    }, function() {
        self._sockets.push(socket);

        socket.on('end', function() {
            var idx = self._sockets.indexOf(socket);
            if (idx !== -1) {
                self._sockets.splice(idx, 1);
            }
        });

        socket.on('error', function(err) {
            // do nothing
        });

        cb(null, socket);
    });

    socket.on('error', function(err) {
        cb(err);
    });
};

Tunnel.prototype.close = function(cb) {
    this._sockets.forEach(function(socket) {
        socket.destroy();
    });
    this._sockets = [];
    this.emit('close');
    if (cb) {
        cb();
    }
};

Object.defineProperty(Tunnel.prototype, 'port', {
    get: function() {
        if (this._sockets.length === 0) {
            return null;
        }
        return this._sockets[0].localPort;
    }
});

module.exports = Tunnel;
