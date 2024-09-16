const si = require('systeminformation');
const os = require('os')
const fs = require('fs')
const { WebSocketServer } = require('ws');
const axios = require('axios');
const port = 3774
const watchlog_server = process.env.WATCHLOG_SERVER
const apiKey = process.env.WATCHLOG_APIKEY
var ioServer = require('socket.io-client');
const watchlogServerSocket = ioServer.connect(watchlog_server, { reconnect: true });
const express = require('express')
const app = express()
const exec = require('child_process').exec;
const path = require('path')
const configFilePath = path.join(__dirname, './../.env');
module.exports = class Application {
    constructor() {
        this.startApp()
    }


    async startApp() {

        const systemInfo = await si.system();
        const systemOsfo = await si.osInfo();
        let uuid = ""
        if (!process.env.UUID) {
            if (systemOsfo.serial && systemOsfo.serial.length > 0) {
                uuid = systemOsfo.serial
            } else if (systemInfo.uuid && systemInfo.uuid.length > 0) {
                uuid = systemInfo.uuid
            } else {
                uuid = systemOsfo.hostname
            }
            fs.appendFileSync(configFilePath, `\nUUID=${uuid}`, 'utf8');


        } else {
            uuid = process.env.UUID
        }



        if (!apiKey) {
            return console.log(new Error("Watchlog Server is not found"))
        }
        if (await this.checkApiKey(uuid, systemOsfo.distro, systemOsfo.release)) {
            this.runAgent(uuid)
        } else {
            console.log("Something went wrong.")
            setTimeout(() => {
                this.runAgent()
            }, 10000)
        }
        // send axios request for check api
    }

    runAgent(uuid) {
        app.listen(port, () => console.log(`Watchlog api agent is running on port 3774`))
        this.getRouter(uuid)
        const wss = new WebSocketServer({ port: 3775, host: "127.0.0.1" }, () => console.log("Watchlog agent is running on port 3775"));
        wss.on('connection', function connection(ws) {
            ws.on('error', console.error);

            ws.on('message', function message(data) {
                try {
                    let body = JSON.parse(data)
                    switch (body.method) {
                        case 'increment':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('increment', { ...body, apiKey, type: 1 })
                            }
                            break;
                        case 'decrement':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('decrement', { ...body, apiKey, type: 1 })
                            }
                            break;
                        case 'distribution':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('distribution', { ...body, apiKey, type: 1 })
                            }
                            break;
                        case 'gauge':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('gauge', { ...body, apiKey, type: 1 })
                            }
                            break;
                        case 'percentage':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('percentage', { ...body, apiKey, type: 1 })
                            }
                            break;
                        case 'systembyte':
                            if (body.metric && body.count) {
                                watchlogServerSocket.emit('systembyte', { ...body, apiKey, type: 1 })
                            }
                            break;
                        case 'log':
                            if (body.service && body.message) {
                                watchlogServerSocket.emit('log', { ...body, type: 1 })
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
        setInterval(this.collectMetrics, 10000);
        // this.collectMetrics()
    }

    getRouter(uuid) {
        app.get("/", async (req, res) => {
            try {
                if (watchlogServerSocket.connected) {
                    let body = req.query
                    res.end()
                    switch (body.method) {
                        case 'increment':
                            if (body.metric && body.value) {
                                watchlogServerSocket.emit('increment', { ...body, type: 1 })
                            }
                            break;
                        case 'decrement':
                            if (body.metric && body.value) {
                                watchlogServerSocket.emit('decrement', { ...body, type: 1 })
                            }
                            break;
                        case 'distribution':
                            if (body.metric && body.value) {
                                watchlogServerSocket.emit('distribution', { ...body, type: 1 })
                            }
                            break;
                        case 'gauge':
                            if (body.metric && body.value) {
                                watchlogServerSocket.emit('gauge', { ...body, type: 1 })
                            }
                            break;
                        case 'percentage':
                            if (body.metric && body.value) {
                                watchlogServerSocket.emit('percentage', { ...body, type: 1 })
                            }
                            break;
                        case 'systembyte':
                            if (body.metric && body.value) {
                                watchlogServerSocket.emit('systembyte', { ...body, type: 1, uuid: uuid })
                            }
                            break;
                        case 'log':
                            if (body.service && body.message) {
                                watchlogServerSocket.emit('log', { ...body, host: "membersgram", apiKey, type: 1, uuid: uuid })
                            }
                            break;
                        default:
                            null
                    }
                }
            } catch (error) {
                console.log(error.message)
            }
        })
    }

    async checkApiKey(uuid, distro, release) {
        try {
            let response = await axios.get(`${watchlog_server}/checkapikey?apiKey=${apiKey}`)
            if (response.status == 200) {
                if (response.data.status == "success") {

                    watchlogServerSocket.emit("setApiKey", { apiKey, host: os.hostname(), ip: getSystemIP(), uuid: uuid, distro: distro, release: release })
                    return true
                } else {
                    if(response.data.message){
                        console.log(response.data.message)
                    }
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
            exec('docker --version', (error, stdout) => {
                if (error) {
                    console.log('Docker is not installed.');
                } else {

                }
            });


            si.dockerImages().then(images => {
                let imagesMetrics = []
                images.forEach(image => {

                    if (image.repoTags.length > 0) {
                        const lastColonIndex = image.repoTags[0].lastIndexOf(':');



                        const name = image.repoTags[0].slice(0, lastColonIndex); // Get part before the last ':'
                        const tag = image.repoTags[0].slice(lastColonIndex + 1); // Get part after the last ':'
                        imagesMetrics.push({
                            id: image.id,
                            name: name,
                            tag: tag,
                            volumes: image.config.Volumes ? image.config.Volumes : [],
                            size: image.size,
                            created: image.created
                        })
                    } else {
                        imagesMetrics.push({
                            id: image.id,
                            name: "null",
                            tag: "null",
                            volumes: image.config.Volumes ? image.config.Volumes.toString() : [],
                            size: image.size,
                            created: image.created
                        })
                    }






                })
                si.dockerInfo().then(info => {
                    if (info) {
                        si.dockerVolumes().then(volumes => {
                            let volumeMetrics = []
                            volumes.forEach(volume => {
                                volumeMetrics.push({
                                    id: volume.name,
                                    name: volume.name,
                                    labels: volume.labels ? volume.labels.toString() : "",
                                    mountpoint: volume.mountpoint,
                                    scope: volume.scope,
                                    created: volume.created
                                })
                            })
                            si.dockerAll().then(containers => {
                                let containerMetrics = []
                                containers.forEach(container => {
                                    try {
                                        containerMetrics.push({
                                            id: container.id,
                                            name: container.name,
                                            image: container.image,
                                            created: container.created,
                                            started: container.started,
                                            state: container.state,
                                            restartCount: container.restartCount,
                                            ports: container.ports.length > 0 ? container.ports : [],
                                            mounts: container.mounts.length > 0 ? container.mounts : [],
                                            memUsage: container.memUsage,
                                            memLimit: container.memLimit,
                                            memPercent: container.memPercent,
                                            cpuPercent: container.cpuPercent,
                                            netIO_rx: container.netIO.rx,
                                            netIO_wx: container.netIO.wx,
                                            blockIO_r: container.blockIO.r,
                                            blockIO_w: container.blockIO.w
                                        })
                                    } catch (error) {

                                    }
                                })
                                if(info.id){
                                    watchlogServerSocket.emit("dockerInfo", {
                                        data: {
                                            id: info.id,
                                            name: "dockerInfo",
                                            containersCount: info.containers,
                                            containersRunning: info.containersRunning,
                                            containersPaused: info.containersPaused,
                                            containersStopped: info.containersStopped,
                                            imagesCount: info.images,
                                            memTotal: info.memTotal,
                                            serverVersion: info.serverVersion,
                                            volumesCount: volumes.length,
                                            volumes: volumeMetrics,
                                            images: imagesMetrics,
                                            containers: containerMetrics
                                        }
                                    })
                                }
                               



                            }).catch(err => null)

                        }).catch(err => null)
                    }
                }).catch(err => null)
            }).catch(err => console.log(err))

            si.fsSize().then(disks => {
                let used = 0
                let total = 0
                let disksMetrics = []

                disks.forEach(item => {
                    if (!isNaN(Number(item.used))) {
                        disksMetrics.push({ metric: `system.disk.${item.fs}.used`, count: item.used, tag: "disk" })
                        disksMetrics.push({ metric: `system.disk.${item.fs}.size`, count: item.size, tag: "disk" })
                        used += item.used
                        if (total < item.size) {
                            total = item.size
                        }
                    }
                })

                used += 23243434
                disksMetrics.push({
                    metric: `system.disk.total`, count: total, tag: "disk"
                })
                disksMetrics.push({
                    metric: `system.disk.use`, count: used, tag: "disk"
                })
                disksMetrics.push({
                    metric: `system.disk.usagePercent`, count: Math.round((used / total) * 100), tag: "disk"
                })




                watchlogServerSocket.emit("serverMetricsArray", {
                    data: disksMetrics
                })

            });



            watchlogServerSocket.emit('serverMetrics', {
                metric: 'uptime',
                count: os.uptime(),
                tag: "uptime"
            });



            // cpu metrics
            si.currentLoad().then(cpuData => {
                const cpuUsage = cpuData.currentLoad.toFixed(2);
                watchlogServerSocket.emit("serverMetricsArray", {
                    data: [
                        {
                            metric: `system.cpu.used`, count: cpuUsage, tag: 'cpu'
                        }
                    ]
                })
            });


            // memory metrics
            si.mem().then(memData => {
                const memUsage = {
                    total: memData.total,
                    free: memData.free + memData.cached,
                    used: memData.used - memData.cached,
                    cached: memData.cached,
                    buffcache: memData.buffcache

                };
                let serverMetrics = [
                    {
                        metric: `system.memory.used`, count: memUsage.used, tag: 'memory'
                    },
                    {
                        metric: `system.memory.free`, count: memUsage.free + memUsage.cached, tag: "memory"
                    },
                    {
                        metric: `system.memory.usagePercent`, count: Math.round((memUsage.used / memUsage.total) * 100), tag: "memory"
                    },
                    {
                        metric: `system.memory.cache`, count: memUsage.cached, tag: "memory"
                    },
                    {
                        metric: `system.memory.buffcache`, count: memUsage.buffcache, tag: "memory"
                    }
                ]
                watchlogServerSocket.emit("serverMetricsArray", {
                    data: serverMetrics
                })


            });


            // network metrics - Bandwidth Usage 
            si.networkStats().then(networkStats => {
                let networks = []

                networkStats.forEach(network => {
                    networks.push({
                        metric: `network.${network.iface}.rx`,
                        count: network.rx_bytes,
                        tag: "networks"
                    })
                    networks.push({
                        metric: `network.${network.iface}.tx`,
                        count: network.tx_bytes,
                        tag: "networks"
                    })
                });


                watchlogServerSocket.emit("serverMetricsArray", {
                    data: networks
                })

            })


            // Active Connections
            si.networkConnections().then(networkConnections => {
                const activeConnections = networkConnections.filter(conn => conn.state === 'ESTABLISHED').length;
                watchlogServerSocket.emit('serverMetrics', {
                    metric: 'network.activeConnections',
                    count: activeConnections,
                    tag: "activeconnection"
                });
            });


            // Latency
            si.inetLatency().then(ping => {
                watchlogServerSocket.emit('serverMetrics', {
                    metric: 'network.latency',
                    count: ping,
                    tag: "latency"
                });
            });




        } catch (error) {

        }

    }

}

watchlogServerSocket.on('reconnect', async (attemptNumber) => {
    if (apiKey) {
        const systemOsfo = await si.osInfo();
        const systemInfo = await si.system();
            
        let uuid = ""
        if (!process.env.UUID) {
            if (systemOsfo.serial && systemOsfo.serial.length > 0) {
                uuid = systemOsfo.serial
            } else if (systemInfo.uuid && systemInfo.uuid.length > 0) {
                uuid = systemInfo.uuid
            } else {
                uuid = systemOsfo.hostname
            }
            fs.appendFileSync(configFilePath, `\nUUID=${uuid}`, 'utf8');


        } else {
            uuid = process.env.UUID
        }
        
        watchlogServerSocket.emit("setApiKey", { apiKey, host: os.hostname(), ip: getSystemIP(), uuid: uuid, distro: systemOsfo.distro, release: systemOsfo.release })
    }

});



function getSystemIP() {
    const networkInterfaces = os.networkInterfaces();
    for (let interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];

        for (let iface of interfaces) {
            // Check if it's an IPv4 address and not internal (i.e., not a localhost address)
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    return null; // No valid external IP found
}