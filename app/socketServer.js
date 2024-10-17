const watchlog_server = process.env.WATCHLOG_SERVER
var ioServer = require('socket.io-client');
const watchlogServerSocket = ioServer.connect(watchlog_server, { reconnect: true });






module.exports = watchlogServerSocket;
