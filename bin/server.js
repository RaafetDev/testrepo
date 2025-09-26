var path = require('path');
var Server = require('../lib/Server');

var argv = require('yargs')
    .usage('$0 [options]')
    .options({
        secure: {
            default: false,
            description: 'use this flag to indicate proxy over https'
        },
        port: {
            default: '3000',
            description: 'listen on this port for outside requests'
        },
        address: {
            default: '0.0.0.0',
            description: 'address to listen on'
        },
        domain: {
            description: 'specify the base domain name. This is optional if hosting localtunnel from a regular address. This is required if hosting a localtunnel server from a subdomain (i.e. lt.example.dom where clients will be client-app.lt.example.com)',
        },
        max_conn: {
            default: 10,
            description: 'maximum number of connections allowed per tunnel'
        },
        max_tcp_sockets: {
            default: 10,
            description: 'maximum number of tcp sockets allowed per tunnel client'
        },
        'path-prefix': {
            default: '',
            description: 'path prefix for tunnel URLs (e.g., "tunnel" for /tunnel/<name>/), empty for subdomain mode'
        }
    })
    .argv;

var server = new Server(argv.port, {
    domain: argv.domain,
    max_conn: argv.max_conn,
    max_tcp_sockets: argv.max_tcp_sockets,
    pathPrefix: argv['path-prefix'] // Pass path prefix to Server
});

server.listen(argv.address, argv.port, function() {
    console.log('server listening on port: %d', server.address().port);
});

process.on('SIGINT', function() {
    server.close(function() {
        process.exit(0);
    });
});

process.on('SIGTERM', function() {
    server.close(function() {
        process.exit(0);
    });
});
