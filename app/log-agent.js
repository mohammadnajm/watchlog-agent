const fs = require('fs');
const chokidar = require('chokidar');
// اتصال به سرور Watchlog
const watchlogServerSocket = require("./socketServer");
let monitorLogs = []

// فایل پیکربندی لاگ‌ها
const CONFIG_FILE = 'log-watchlist.json';
console.log(CONFIG_FILE)
let uniqueNames = new Set(); // برای جلوگیری از نام‌های تکراری
let logConfig = loadConfig();

// الگوهای استاندارد برای `auto`
const autoPatterns = {
    nginx: /^(\S+) - - \[(.*?)\] "(.*?)" (\d+) (\d+) "(.*?)" "(.*?)"/,
    pm2: /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([A-Z]+)\] (.+)$/,
    redis: /^\d{2} \w{3} \d{2}:\d{2}:\d{2} (\w+): (.*)$/,
    mysql: /^\d{6} \s+\d{1,2}:\d{2}:\d{2} \[\w+\] (\w+): (.*)$/,
    docker: /^(\S{24}) (\S+) (\S+) (\[.*?\]) (.*)$/,
    postgresql: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]+) \[(\d+)\]: \[([A-Z]+)\] (.+)$/,
    mongodb: /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d+Z) (\[.*?\]) (\S+) (.*)$/,
    default: /^(.*?)\s+(\w+):\s+(.*)$/,
};

const VALID_LEVELS = ["success", "info", "warning", "error", "critical"]; // لیست معتبر

// تابع خواندن فایل تنظیمات
function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        console.error(`Error: ${CONFIG_FILE} not found!`);
        process.exit(1);
    }

    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        let config = JSON.parse(data);
        ensureUniqueNames(config.logs);
        validatePatterns(config.logs);
        return config;
    } catch (error) {
        console.error("Error parsing JSON config:", error);
        process.exit(1);
    }
}

// تابع بررسی و تصحیح نام‌های تکراری
function ensureUniqueNames(logs) {
    uniqueNames.clear();

    logs.forEach(log => {
        let originalName = log.name;
        let newName = originalName;
        let counter = 1;

        while (uniqueNames.has(newName)) {
            newName = `${originalName} (${counter})`;
            counter++;
        }

        log.name = newName;
        uniqueNames.add(newName);
    });
}

// تابع بررسی صحت `Regex` برای `custom pattern`
function validatePatterns(logs) {
    logs.forEach(log => {
        if (log.format === "custom" && log.pattern) {
            try {
                new RegExp(log.pattern);
            } catch (error) {
                console.error(`❌ Invalid pattern for ${log.name}:`, log.pattern);
                process.exit(1);
            }
        }
    });
}

// پردازش لاگ با `auto` (تشخیص خودکار فرمت)
function parseAutoLogFormat(log, service) {
    const pattern = autoPatterns[service] || autoPatterns.default;
    const match = log.match(pattern);

    if (match) {
        return {
            date: new Date(match[1] || Date.now()).toISOString(),
            level: match[2] || "info",
            message: match[3] || log
        };
    }

    // اگر فرمت تشخیص داده نشد، لاگ رو به‌صورت متنی ارسال کن
    return {
        date: new Date().toISOString(),
        level: "info",
        message: log
    };
}

// پردازش لاگ
function processLogLine(log, config) {
    let logData = {
        date: new Date().toISOString(),
        message: log,
        level: "info",
        service: config.service,
        name: config.name
    };
    
    // custom format and use pattern
    if (config.format === "custom" && config.pattern) {
        const regex = new RegExp(config.pattern);
        const match = log.match(regex);

        if (match) {
            logData.date = new Date(match[1] || Date.now()).toISOString();
            logData.level = match[2] || "info";
            logData.message = match[3] || log;
        }
    }
    // format auto
    else if (config.format === "auto") {
        logData = { ...logData, ...parseAutoLogFormat(log, config.service) };
    }

    // بررسی کنیم که مقدار `level` معتبر باشه
    if (!VALID_LEVELS.includes(logData.level.toLowerCase())) {
        logData.level = "info";
    }



    // Send log with WebSocket
    watchlogServerSocket.emit("logs/watchlist", logData);
}

// مانیتور کردن تمام فایل‌های ثبت شده در `log-watchlist.json`
function startMonitoring() {
    logConfig.logs.forEach(logEntry => {
        if (!fs.existsSync(logEntry.path)) {
            console.warn(`⚠ Warning: File ${logEntry.path} does not exist! Skipping...`);
            return;
        }

        console.log(`👀 Monitoring: ${logEntry.name} (${logEntry.path})`);
        monitorLogs.push(logEntry)

        // استفاده از chokidar برای تشخیص تغییرات در فایل‌های لاگ
        chokidar.watch(logEntry.path, { persistent: true, ignoreInitial: false })
            .on('change', filePath => {
                const stream = fs.createReadStream(filePath, { encoding: 'utf8', start: fs.statSync(filePath).size - 500 });
                stream.on('data', data => {
                    const lines = data.split('\n').filter(line => line.trim() !== "");
                    lines.forEach(line => processLogLine(line, logEntry));
                });
            })
            .on('error', error => console.error(`Error watching file ${logEntry.path}:`, error));
    });


    setTimeout(() => {
        if (monitorLogs.length > 0 && process.env.WATCHLOG_APIKEY && process.env.UUID) {
            watchlogServerSocket.emit("watchlist/listfile", { monitorLogs, apiKey: process.env.WATCHLOG_APIKEY, uuid: process.env.UUID })
        } else {
            console.log(process.env.UUID)
        }
    }, 10000)
}

// اجرای مانیتورینگ
startMonitoring();





// در صورت تغییر `log-watchlist.json`، تنظیمات را مجدد بارگذاری کن
chokidar.watch(CONFIG_FILE, { persistent: true })
    .on('change', () => {
        console.log("🔄 Reloading config...");
        logConfig = loadConfig();
        startMonitoring();
    });
