const { exec } = require('child_process');

// Collect and Send MongoDB Metrics
function sendMongoMetrics() {
    exec('mongosh --quiet --eval "JSON.stringify(db.serverStatus())"', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            return;
        }

        try {
            const serverStatus = JSON.parse(stdout);  // Now `stdout` is valid JSON
            const connections = serverStatus.connections.current;
            const memory = serverStatus.mem.resident;
            const opsInsert = serverStatus.opcounters.insert;
            const opsQuery = serverStatus.opcounters.query;
            const networkIn = serverStatus.network.bytesIn;
            const networkOut = serverStatus.network.bytesOut;
            const latency = serverStatus.opLatencies.commands.latency;

            // Send to Watchlog
            console.log('gauge', { metric: 'mongodb.connections', count: connections });
            console.log('systembyte', { metric: 'mongodb.memory.usage', count: memory });  //MB
            console.log('increment', { metric: 'mongodb.operations.insert', count: opsInsert });
            console.log('increment', { metric: 'mongodb.operations.query', count: opsQuery.high * Math.pow(2, 32) + opsQuery.low });
            const fullValue = opsQuery.high * Math.pow(2, 32) + opsQuery.low;
            console.log('systembyte', { metric: 'mongodb.network.bytesIn', count: networkIn });
            console.log('systembyte', { metric: 'mongodb.network.bytesOut', count: networkOut });
            console.log('gauge', { metric: 'mongodb.latency.commands', count: latency });

        } catch (error) {
            console.error("Error parsing MongoDB output:", error.message);
        }
    });
}

sendMongoMetrics()

// setInterval(sendMongoMetrics, 2000);  // Collect metrics every 60 seconds
