const pm2 = require('pm2');

exports.getData = function (callback) {

    try {
        pm2.list((err, processList) => {
            if (err) {
                console.log(err.message)
                callback(null)
            } else {
                const pm2Metrics = processList.map(process => ({
                    id: process.pm_id,
                    pm2_env: process.pm2_env.exec_interpreter,
                    instances: process.pm2_env.instances,
                    name: process.name,
                    status: process.pm2_env.status,
                    memory: process.monit.memory,   // Memory usage in bytes
                    cpu: process.monit.cpu,         // CPU usage percentage
                    uptime: process.pm2_env.pm_uptime,
                    restarts: process.pm2_env.restart_time,
                }));

                callback(pm2Metrics)
            }

        });
    } catch (error) {
        callback(null)
    }


}