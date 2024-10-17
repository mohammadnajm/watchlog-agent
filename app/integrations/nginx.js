const watchlogServerSocket = require("../socketServer");
const { Tail } = require('tail');
const url = require('url');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');

const integrations = require("../../integration.json")

for (let integrate in integrations) {
    if (integrations[integrate].service == 'nginx' && integrations[integrate].monitor == true) {

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
                                callback(true, uptime, status, null);  // No version available in case of error
                            }

                            // Parse the version from stderr (nginx -v outputs version to stderr)
                            version = stderr.match(/nginx\/([0-9.]+)/)?.[1] || null;

                            callback(true, uptime, status, version);
                        });
                    });
                }


            });
        }

        function fetchNginxStatus(callback) {
            try {
                axios.get(integrations[integrate].nginx_status_url || 'http://localhost:8080/nginx_status').then(response => {
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
                } else {
                    // console.log('NGINX is not installed');
                }
            });
        }

        setInterval(checkNginxStatusData, 10000);


        // Adjusted regex pattern to match the log format with the Referer field
        const logRegex = /^(\S+) - (\S+) \[([^\]]+)\] "([^"]+)" "([^"]+)" (\d+) (\d+) "([^"]*)" "([^"]*)" (\S+) (\S+) (\S+) (\S+) (\S+)$/;

        // Tail the access log file
        const logFilePath = integrations[integrate].accessLog || "/var/log/nginx/access.log"; // Update this path to your access.log location
        // Check if the log file exists before tailing it
        if (!fs.existsSync(logFilePath)) {
            // console.error(`Log file does not exist: ${logFilePath}`);
            // process.exit(1); // Optionally, exit the app or continue based on your preference
        } else {
            const tail = new Tail(logFilePath);

            // Data structure to hold counts and response times for each API, method, and status code
            let apiMethodStatusCounts = {};

            // Function to validate origin, API, and response time
            function isValidOriginAndApi(origin, api, method, status, responseTime) {
                if (!origin || !api || !method || isNaN(status) || isNaN(responseTime)) {
                    return false; // Skip log if any required part is missing or invalid
                }
                if (!origin.startsWith('http')) {
                    return false; // Invalid origin format
                }
                return true;
            }

            // Process each log line as it's written to the access log
            tail.on('line', (logLine) => {
                try {
                    const match = logLine.match(logRegex);

                    if (match) {
                        const parsedLog = {
                            referer: match[5],  // Referer field (this contains the full origin and path)
                            request: match[4],  // Full request string (e.g., POST /main/v1/orders?page=1 HTTP/1.1)
                            status: parseInt(match[6], 10),  // Status code
                            responseTime: parseFloat(match[10]),  // Response time (e.g., 0.070)
                        };

                        // Extract the HTTP method and the API endpoint from the request (e.g., POST /main/v1/orders HTTP/1.1)
                        const requestParts = parsedLog.request.split(' ');
                        const method = requestParts[0];  // HTTP method (e.g., GET, POST)
                        let api = requestParts[1];  // Full API path (e.g., /main/v1/orders?page=1&status=all)

                        // Parse the referer URL (assuming the referer is the origin + path we care about)
                        let parsedUrl;
                        try {
                            parsedUrl = url.parse(parsedLog.referer);
                        } catch (parseError) {
                            // console.warn(`Skipping invalid referer URL: ${parsedLog.referer} \nError: ${parseError.message}`);
                            return;  // Skip this log line if URL parsing fails
                        }

                        const origin = parsedUrl.protocol + "//" + parsedUrl.host;  // Extract origin (e.g., https://api.membersgram.com)

                        // Remove the query parameters from the API path
                        const cleanApiPath = parsedUrl.pathname;  // Extract only the path (e.g., /main/v1/orders)

                        // Validate origin, api, method, status, and response time before proceeding
                        if (!isValidOriginAndApi(origin, cleanApiPath, method, parsedLog.status, parsedLog.responseTime)) {
                            // console.warn(`Skipping invalid log entry: ${logLine}`);
                            return; // Skip this log if any validation fails
                        }

                        // Ensure we have a structure to hold the counts and response times
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
                            apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status] = {
                                count: 0,
                                totalResponseTime: 0,  // Sum of all response times
                            };
                        }

                        // Increment the count and accumulate response time for the specific status code
                        const statusEntry = apiMethodStatusCounts[origin][cleanApiPath][method][parsedLog.status];
                        statusEntry.count += 1;
                        statusEntry.totalResponseTime += parsedLog.responseTime;
                    } else {
                        // console.warn(`Log line does not match the expected format: ${logLine}`);
                    }
                } catch (error) {
                    // console.error(`Error processing log line: ${logLine} \nError: ${error.message}`);
                }
            });

            // Function to process and display the aggregated API, method, and status counts
            function processAndSendAggregatedData() {
                try {
                    let apiMethodStatusCountsCheck = apiMethodStatusCounts;
                    apiMethodStatusCounts = {};

                    const result = [];
                    for (const origin in apiMethodStatusCountsCheck) {
                        for (const api in apiMethodStatusCountsCheck[origin]) {
                            for (const method in apiMethodStatusCountsCheck[origin][api]) {
                                for (const status in apiMethodStatusCountsCheck[origin][api][method]) {
                                    const statusEntry = apiMethodStatusCountsCheck[origin][api][method][status];
                                    const avgResponseTime = (statusEntry.totalResponseTime / statusEntry.count).toFixed(3);  // Calculate average response time

                                    result.push({
                                        origin,
                                        api,  // Clean API path without query parameters
                                        method,
                                        status: parseInt(status, 10),
                                        count: statusEntry.count,
                                        avgResponseTime: parseFloat(avgResponseTime),  // Average response time
                                    });
                                }
                            }
                        }
                    }


                    if (result.length > 0) {
                        watchlogServerSocket.emit("integrations/nginx.access.log", result)
                    }

                } catch (error) {
                    // console.error(`Error processing aggregated data: ${error.message}`);
                }
            }

            // Schedule the process every 1 minute (60,000 milliseconds)
            setInterval(processAndSendAggregatedData, 10000);

            tail.on('error', (error) => {
                // console.error('Error reading the log file:', error);
            });
        }



    }


}


