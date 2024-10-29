const watchlogServerSocket = require("../socketServer");
const { Tail } = require('tail');
const url = require('url');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
const maxmind = require('maxmind');
let apiMethodStatusCounts = {};
let nginxStatusUrl = "http://localhost:8080/nginx_status"
const integrations = require("../../integration.json")
let nginxInstall = true
// Path to GeoLite2-City database
const geoDbPath = 'GeoLite2-City.mmdb';  // Replace with your actual mmdb file path
let lookup;
// Load the GeoLite2 database
try {
    lookup = maxmind.open(geoDbPath);
} catch (err) {
    console.error("Error loading GeoLite2 database:", err);
}

for (let integrate in integrations) {
    if (integrations[integrate].service == 'nginx' && integrations[integrate].monitor == true) {
        nginxStatusUrl = integrations[integrate].nginx_status_url ? integrations[integrate].nginx_status_url : "http://localhost:8080/nginx_status"
        setInterval(checkNginxStatusData, 10000);

        const logRegex = /^(\S+) - (\S+) \[([^\]]+)\] "([^"]+)" "([^"]+)" (\d+) (\d+) "([^"]*)" "([^"]*)" (\S+) (\S+) (\S+) (\S+) (\S+)$/;

        const logFilePath = integrations[integrate].accessLog || "/var/log/nginx/access.log";
        if (!fs.existsSync(logFilePath)) {
            // Log file doesn't exist
            console.warn("access log not found")
        } else {
            const tail = new Tail(logFilePath);

            function isValidOriginAndApi(origin, api, method, status, responseTime) {
                if (!origin || !api || !method || isNaN(status) || isNaN(responseTime)) {
                    return false;
                }
                if (!origin.startsWith('http')) {
                    return false;
                }
                return true;
            }
            tail.on('line', (logLine) => {
                try {
                    if (nginxInstall) {
                        const match = logLine.match(logRegex);

                        if (match) {
                            const parsedLog = {
                                ipAddress: match[1], // Client IP address
                                referer: match[5],
                                request: match[4],
                                status: parseInt(match[6], 10),
                                responseTime: parseFloat(match[10]),
                                requestSize: parseInt(match[7], 10) // Capture request size

                            };

                            const requestParts = parsedLog.request.split(' ');
                            const method = requestParts[0];
                            let api = requestParts[1];
                            let parsedUrl;
                            try {
                                parsedUrl = url.parse(parsedLog.referer);
                            } catch (parseError) {
                                return;
                            }

                            let origin = parsedUrl.protocol + "//" + parsedUrl.host;
                            let cleanApiPath = parsedUrl.pathname;
                            if(origin && origin !== "/"){
                                origin = origin.replace(/\/+$/, '')
                            }

                            if(cleanApiPath && cleanApiPath !== "/"){
                                cleanApiPath = cleanApiPath.replace(/\/+$/, '')
                            }
                            if (!isValidOriginAndApi(origin, cleanApiPath, method, parsedLog.status, parsedLog.responseTime)) {
                                return;
                            }

                            // Use the maxmind lookup to get the country based on IP
                            let country = 'Unknown';
                            try {
                                const geoData = lookup.get(parsedLog.ipAddress);
                                if (geoData && geoData.country && geoData.country.iso_code) {
                                    country = geoData.country.iso_code
                                }
                                // country = geoData?.country?.iso_code || 'Unknown'; // ISO country code (e.g., "US", "DE")
                            } catch (geoError) {
                                // console.warn(`GeoIP lookup failed for IP: ${parsedLog.ipAddress}`);
                            }

                            // Group by origin, api, method, status, and country
                            if (!apiMethodStatusCounts[origin]) {
                                apiMethodStatusCounts[origin] = {};
                            }

                            if (!apiMethodStatusCounts[origin][cleanApiPath]) {
                                apiMethodStatusCounts[origin][cleanApiPath] = {};
                            }

                            if (!apiMethodStatusCounts[origin][cleanApiPath][method]) {
                                apiMethodStatusCounts[origin][cleanApiPath][method] = {};
                            }

                            if (!apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status]) {
                                apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status] = {};
                            }

                            if (!apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status][country]) {
                                apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status][country] = {
                                    count: 0,
                                    totalResponseTime: 0,
                                    totalRequestSize: 0, // Initialize request size accumulation
                                };
                            }

                            // Increment the count and accumulate the response time for each country
                            const statusEntry = apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status][country];
                            statusEntry.count += 1;
                            statusEntry.totalResponseTime += parsedLog.responseTime;
                            statusEntry.totalRequestSize += parsedLog.requestSize;

                        } else {
                            // console.log("dosen't match")
                        }
                    }

                } catch (error) {
                    // console.error(`Error processing log line: ${logLine} \nError: ${error.message}`);
                }
            });

            tail.on('error', (error) => {
                console.error('Error reading the nginx log file:', error);
            });
        }
    }
}

// Function to check NGINX status, uptime, and version
function checkNginxStatus(callback) {
    exec('systemctl status nginx', (error, stdout, stderr) => {
        if (error) {
            // NGINX is not installed or not running
            // console.error(`Error: ${stderr}`);
            callback(false, null, null, null);  // Add 'null' for status in case of error
        } else {
            // NGINX is installed, now we check the status and uptime
            exec('systemctl show nginx --property=ActiveState,ExecMainStartTimestamp', (error, stdout, stderr) => {
                if (error) {
                    // console.error(`Error getting uptime: ${stderr}`);
                    callback(true, null, null, null);  // Add 'null' for version if an error occurs
                }

                // Parse the output
                const output = stdout.split('\n');
                const activeState = output.find(line => line.startsWith('ActiveState='));
                const startTime = output.find(line => line.startsWith('ExecMainStartTimestamp='));

                let status = null;
                let uptime = null;
                let version = null;

                if (activeState) {
                    status = activeState.split('=')[1];  // Get the ActiveState (status)
                }

                if (startTime) {
                    uptime = startTime.split('=')[1];  // Get the start timestamp (uptime)
                }

                // Now check the NGINX version
                exec('nginx -v', (error, stdout, stderr) => {
                    if (error) {
                        // console.error(`Error getting NGINX version: ${stderr}`);
                        nginxInstall = true
                        callback(true, uptime, status, null);  // No version available in case of error
                    }

                    // Parse the version from stderr (nginx -v outputs version to stderr)
                    const matchVersion = stderr.match(/nginx\/([0-9.]+)/);
                    version = matchVersion ? matchVersion[1] : null;

                    callback(true, uptime, status, version);
                });

            });
        }


    });
}



function fetchNginxStatus(callback) {
    try {
        axios.get(nginxStatusUrl).then(response => {
            let statusNginx = null

            try {
                const statusText = response.data;

                // Parse the status data
                const activeConnections = /Active connections:\s+(\d+)/.exec(statusText)[1];
                const [accepts, handled, requests] = statusText
                    .match(/(\d+)\s+(\d+)\s+(\d+)/)
                    .slice(1, 4);

                const reading = /Reading:\s+(\d+)/.exec(statusText)[1];
                const writing = /Writing:\s+(\d+)/.exec(statusText)[1];
                const waiting = /Waiting:\s+(\d+)/.exec(statusText)[1];


                // Send this data to Watchlog or your database (e.g., InfluxDB)
                // Replace this with your logic to send to InfluxDB or other databases
                statusNginx = {
                    activeConnections,
                    accepts,
                    handled,
                    requests,
                    reading,
                    writing,
                    waiting,
                }
            } catch (error) { }

            callback(statusNginx);
        }).catch(err => callback(null));

    } catch (error) {
        // console.error('Error fetching NGINX status:', error);
        callback(null)
    }
}


function checkNginxStatusData() {
    checkNginxStatus((isInstalled, uptime, status, version) => {
        // console.log(isInstalled, uptime, status, version)
        if (isInstalled) {
            fetchNginxStatus((statusNginx) => {
                watchlogServerSocket.emit("integrations/nginx.status", {
                    data: {
                        isInstalled, uptime, status, version, statusNginx
                    }
                })

            })
            processAndSendAggregatedData()
        } else {
            // console.log('NGINX is not installed');
        }
    });
}


function processAndSendAggregatedData() {
    try {
        let apiMethodStatusCountsCheck = apiMethodStatusCounts;
        apiMethodStatusCounts = {};

        const result = [];
        for (const origin in apiMethodStatusCountsCheck) {
            for (const api in apiMethodStatusCountsCheck[origin]) {
                for (const method in apiMethodStatusCountsCheck[origin][api]) {
                    for (const status in apiMethodStatusCountsCheck[origin][api][method]) {
                        for (const country in apiMethodStatusCountsCheck[origin][api][method][status]) {
                            const statusEntry = apiMethodStatusCountsCheck[origin][api][method][status][country];
                            const avgResponseTime = (statusEntry.totalResponseTime / statusEntry.count).toFixed(3);
                            const totalRequestSize = statusEntry.totalRequestSize ; // Calculate average request size

                            // Add country to the result
                            if (origin && api && method && parseInt(status, 10) && statusEntry && avgResponseTime && country) {
                                result.push({
                                    origin,
                                    api,
                                    method,
                                    status: parseInt(status, 10),
                                    count: statusEntry.count,
                                    avgResponseTime: parseFloat(avgResponseTime),
                                    totalRequestSize: parseFloat(totalRequestSize), // Optional: Include average request size
                                    country: country, // Include the country in the result
                                });
                            }

                        }
                    }
                }
            }
        }
        if (result.length > 0) {
            watchlogServerSocket.emit("integrations/nginx.access.log", {
                data: result
            });
        }

    } catch (error) {
        console.error(`Error processing aggregated data: ${error.message}`);
    }
}
