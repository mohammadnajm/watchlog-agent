const { exec } = require('child_process');
// Helper function to execute MongoDB command
function execMongoCommand(command, callback) {

    exec(command, (error, stdout, stderr) => {

        if (error) {
            callback(null)
        }
        if (stderr) {
            callback(null)
        }
        callback(stdout);
    });
}
const getLongValue = (obj) => {
    return typeof obj === 'object' && obj.$numberLong ? parseInt(obj.$numberLong, 10) : obj;
};


exports.getData = function (host, port, username, password, callback) {
    exec(`mongosh --version`, (error, stdout, stderr) => {
        if (error) {

            exec(`mongo --host ${host} --port ${port} --version`, (error2, stdout2, stderr2) => {
                if (error2) {
                    console.log(null)
                } else {
                    let command = ""
                    if (username && username.length > 0) {
                        command = `mongo --host ${host} --port ${port} --username ${username} --password ${password} --authenticationDatabase admin --quiet --eval "JSON.stringify(db.serverStatus())"`

                    } else {
                        command = `mongo  --host ${host} --port ${port} --authenticationDatabase admin --quiet --eval "JSON.stringify(db.serverStatus())"`

                    }
                    let version = stdout2.match(/"version":\s*"([\d.]+)"/) ? stdout2.match(/"version":\s*"([\d.]+)"/)[1] : "";

                    execMongoCommand(command, (stdout) => {
                        try {
                            const serverStatus = JSON.parse(stdout); // Parse JSON output safely

                            
                            let metrics = {
                                version,
                                uptime: serverStatus.uptime,
                                connections: serverStatus.connections.current,
                                availableConnections: serverStatus.connections.available,
                                usageMemory: serverStatus.mem.resident,
                                virtualMemory: serverStatus.mem.virtual,
                                insert: getLongValue(serverStatus.opcounters.insert),
                                query: getLongValue(serverStatus.opcounters.query),
                                update: getLongValue(serverStatus.opcounters.update),
                                delete: getLongValue(serverStatus.opcounters.delete),
                                command: getLongValue(serverStatus.opcounters.command),
                                networkIn: getLongValue(serverStatus.network.bytesIn),
                                networkOut: getLongValue(serverStatus.network.bytesOut),
                                networkRequests: getLongValue(serverStatus.network.numRequests),
                                latencyCommands: getLongValue(serverStatus.opLatencies.commands.latency),
                                latencyReads: getLongValue(serverStatus.opLatencies.reads.latency),
                                latencyWrites: getLongValue(serverStatus.opLatencies.writes.latency)
                            }
                            callback(metrics)

                        } catch (error) {
                            callback(null)
                        }
                    });
                }
            });
        } else {
            let version = stdout.trim()
            const command = `mongosh --host ${host} --port ${port} --username ${username} --password ${password} --authenticationDatabase admin --quiet --eval "JSON.stringify(db.serverStatus())"`

            execMongoCommand(command, (stdout) => {
                try {
                    const serverStatus = JSON.parse(stdout); // Parse JSON output safely
                    const connections = serverStatus.connections.current || 0;
                    const opsQuery = serverStatus.opcounters.query || 0;
                    const availableConnections = serverStatus.connections.available;
                    const memoryResident = serverStatus.mem.resident;
                    const memoryVirtual = serverStatus.mem.virtual;

                    // ops
                    const opsInsert = serverStatus.opcounters.insert;
                    const opsUpdate = serverStatus.opcounters.update;
                    const opsDelete = serverStatus.opcounters.delete;
                    const opsCommand = serverStatus.opcounters.command;

                    // network
                    const networkIn = serverStatus.network.bytesIn;
                    const networkOut = serverStatus.network.bytesOut;
                    const networkRequests = serverStatus.network.numRequests;

                    // latency
                    const latencyCommands = serverStatus.opLatencies.commands.latency;
                    const latencyReads = serverStatus.opLatencies.reads.latency;
                    const latencyWrites = serverStatus.opLatencies.writes.latency;
                    let metrics = {
                        version,
                        uptime: serverStatus.uptime,
                        connections: connections,
                        availableConnections: availableConnections,
                        usageMemory: memoryResident,
                        virtualMemory: memoryVirtual,
                        insert: opsInsert.high * Math.pow(2, 32) + opsInsert.low,
                        query: opsQuery.high * Math.pow(2, 32) + opsQuery.low,
                        update: opsUpdate.high * Math.pow(2, 32) + opsUpdate.low,
                        delete: opsDelete.high * Math.pow(2, 32) + opsDelete.low,
                        command: opsCommand.high * Math.pow(2, 32) + opsCommand.low,
                        networkIn: networkIn.high * Math.pow(2, 32) + networkIn.low,
                        networkOut: networkOut.high * Math.pow(2, 32) + networkOut.low,
                        networkRequests: networkRequests.high * Math.pow(2, 32) + networkRequests.low,
                        latencyCommands: latencyCommands.high * Math.pow(2, 32) + latencyCommands.low,
                        latencyReads: latencyReads.high * Math.pow(2, 32) + latencyReads.low,
                        latencyWrites: latencyWrites.high * Math.pow(2, 32) + latencyWrites.low,
                    }
                    callback(metrics)

                } catch (error) {
                    callback(null)
                }
            });
        }
    });
}