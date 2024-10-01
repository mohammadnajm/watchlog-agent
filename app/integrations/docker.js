const si = require('systeminformation');


exports.getData = function (callback) {
    si.dockerInfo().then(info => {
        if (info && info.id) {
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
                                callback(null)
                            }
                        })
                        callback({
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
                        })

                    }).catch(err => {
                        console.log(err.message)
                        callback(null)
                    })

                }).catch(err => {
                    console.log(err.message)
                    callback(null)
                })


            }).catch(err => {
                console.log(err.message)
                callback(null)
            })

        } else {
            callback(null)
        }
    }).catch(err => {
        console.log(err.message)
        callback(null)

    })



}

// sudo chmod 666 /var/run/docker.sock


