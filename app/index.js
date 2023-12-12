const si = require('systeminformation');
const os = require('os')
const { WebSocketServer } = require('ws');
const axios = require('axios');
const port = 3774
const watchlog_server = process.env.SERVER
const apiKey = process.env.APIKEY
var ioServer = require('socket.io-client');
const watchlogServerSocket = ioServer.connect(watchlog_server, { reconnect: true });

module.exports = class Application {
    constructor() {
        this.startApp()
    }

    async startApp() {
        if (!apiKey) {
            return console.log(new Error("Watchlog Server is not found"))
        }
        if (await this.checkApiKey()) {
            this.runAgent()
        }else{
            console.log("error")
        }
        // send axios request for check api
    }

    runAgent() {
        const wss = new WebSocketServer({ port: port, host: "127.0.0.1" }, () => console.log("Watchlog agent in running"));
        wss.on('connection', function connection(ws) {
            ws.on('error', console.error);

            ws.on('message', function message(data) {
                try {
                    let body = JSON.parse(data)
                    switch (body.method) {
                        case 'increment':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('increment', { ...body, host: os.hostname(),apiKey, type: 1 })
                            }
                            break;
                        case 'decrement':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('decrement', { ...body, host: os.hostname(),apiKey, type: 1 })
                            }
                            break;
                        case 'distribution':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('distribution', { ...body, host: os.hostname(),apiKey, type: 1 })
                            }
                            break;
                        case 'gauge':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('gauge', { ...body, host: os.hostname(),apiKey , type: 1})
                            }
                            break;
                        case 'percentage':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('percentage', { ...body, host: os.hostname(),apiKey, type: 1 })
                            }
                            break;
                        case 'systembyte':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('systembyte', { ...body, host: os.hostname(),apiKey , type: 1})
                            }
                            break;
                        case 'log':
                            if (body.service && body.message) {
                                watchlogServerSocket.emit('log', { ...body, host: "membersgram",apiKey, type: 1 })
                            }
                            break;
                        default:
                            null
                        // code block
                    }
                } catch (error) {
                    console.log(error.message)
                }
            });

        });
        setInterval(this.collectMetrics, 60000);
    }

    async checkApiKey() {
        try {
            let response = await axios.get(`${watchlog_server}/checkapikey?apiKey=${apiKey}`)
            if (response.status == 200) {
                if (response.data.status == "success") {
                    watchlogServerSocket.emit("setApiKey", {apiKey, host: os.hostname()})
                    return true
                } else {
                    return false
                }
            } else {
                return false
            }
        } catch (error) {
            console.log(error.message)
            return false
        }
    }


    // to collect and log metrics
    async collectMetrics() {
        try {
            const cpuData = await si.currentLoad();
            const cpuUsage = cpuData.currentLoad.toFixed(2);

            const memData = await si.mem();
            const memUsage = {
                total: memData.total,
                free: memData.free,
                used: memData.used
            };

            const disks = await si.fsSize();
            const diskInfo = disks.map(disk => ({
                filesystem: disk.fs,
                size: disk.size,
                used: disk.used,
                available: disk.available
            }));

            watchlogServerSocket.emit('percentage', { metric: `system.cpu.used(${os.hostname()})`, host: os.hostname(), apiKey, count: cpuUsage , type: 0})
            watchlogServerSocket.emit('systembyte', { metric: `system.memory.used(${os.hostname()})`, host: os.hostname(), apiKey, count: memUsage.used , type: 0})
            watchlogServerSocket.emit('systembyte', { metric: `system.memory.free(${os.hostname()})`, host: os.hostname(), apiKey, count: memUsage.free, type: 0})
            watchlogServerSocket.emit('systembyte', { metric: `system.memory.usagePercent(${os.hostname()})`, host: os.hostname(), apiKey, count: Math.round((memUsage.used/memUsage.total) * 100) , type: 0})
            diskInfo.forEach(item => {
                watchlogServerSocket.emit('systembyte', { metric: `system.disk.${item.filesystem}.used(${os.hostname()})`, host: os.hostname(), apiKey, count: item.used, type: 0})
                watchlogServerSocket.emit('systembyte', { metric: `system.disk.${item.filesystem}.free(${os.hostname()})`, host: os.hostname(), apiKey, count: item.available, type: 0})
            })
        } catch (error) {

        }

    }

}
