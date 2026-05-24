const express = require('express');
const path = require('path');
const fs = require('fs');
const { runScrape, cleanupInactiveJobs, loadConfig, CONFIG_FILE, findFirefoxCookieDb, extractFirefoxCookies } = require('./scraper_helper');

const app = express();
app.use(express.json()); // Support JSON body parsing

const PORT = process.env.PORT || 8080;

// Serve static files
app.use(express.static(__dirname));

// Main entry points
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'motivatie.html')));
app.get('/cv', (req, res) => res.sendFile(path.join(__dirname, 'cv-a4.html')));
app.get('/cv-canva', (req, res) => res.sendFile(path.join(__dirname, 'cv-a4-canva.html')));
app.get('/scraper', (req, res) => res.sendFile(path.join(__dirname, 'scraper.html')));

// Global Scraper Status State
let scrapeState = {
    status: 'idle', // idle, searching, crawling, completed, error
    progress: 0,
    total: 0,
    currentJob: '',
    logs: [],
    error: null
};

// Helper to log state
function addLog(msg) {
    const formatted = `[${new Date().toLocaleTimeString()}] ${msg}`;
    scrapeState.logs.push(formatted);
    if (scrapeState.logs.length > 300) scrapeState.logs.shift();
}

// Config Endpoints
app.get('/api/config', (req, res) => {
    try {
        const config = loadConfig();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration object' });
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
        res.json({ success: true, config: newConfig });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/scrape/sync-firefox-cookies', (req, res) => {
    try {
        const dbPath = findFirefoxCookieDb();
        if (!dbPath) {
            return res.status(404).json({ error: 'Firefox cookies database could not be auto-located.' });
        }
        
        const cookieStr = extractFirefoxCookies(dbPath);
        
        // Read, update and save config
        const config = loadConfig();
        if (!config.headers) {
            config.headers = {};
        }
        config.headers.Cookie = cookieStr;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        
        res.json({ success: true, cookiesCount: cookieStr.split(';').length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Scraper Endpoints
app.post('/api/scrape', (req, res) => {
    if (scrapeState.status === 'searching' || scrapeState.status === 'crawling') {
        return res.status(400).json({ error: 'Scraper is already running' });
    }
    
    // Reset state
    scrapeState = {
        status: 'searching',
        progress: 0,
        total: 0,
        currentJob: 'Starting search...',
        logs: [],
        error: null
    };
    
    addLog('Triggered scraper from Web UI');
    
    // Run in background
    runScrape(
        (msg) => addLog(msg),
        (prog) => {
            scrapeState.status = prog.status;
            scrapeState.progress = prog.progress;
            scrapeState.total = prog.total;
            scrapeState.currentJob = prog.currentJob;
        }
    ).then((jobs) => {
        scrapeState.status = 'completed';
        scrapeState.currentJob = `Finished! Successfully saved ${jobs.length} roles.`;
        addLog(`Completed! Saved ${jobs.length} developer jobs.`);
    }).catch((err) => {
        scrapeState.status = 'error';
        scrapeState.error = err.message;
        scrapeState.currentJob = 'Error occurred during scraping session.';
        addLog(`ERROR: ${err.message}`);
    });
    
    res.json({ success: true, message: 'Scraping started in background' });
});

app.get('/api/scrape/status', (req, res) => {
    res.json(scrapeState);
});

app.get('/api/scrape/stats', (req, res) => {
    try {
        const config = loadConfig();
        const file = config.outputFile || path.join(__dirname, 'vdab_developer_jobs.json');
        if (fs.existsSync(file)) {
            const jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
            const stats = {
                total: jobs.length,
                active: jobs.filter(j => j.active !== false).length,
                inactive: jobs.filter(j => j.active === false).length
            };
            res.json(stats);
        } else {
            res.json({ total: 0, active: 0, inactive: 0 });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/scrape/cleanup', (req, res) => {
    if (scrapeState.status === 'searching' || scrapeState.status === 'crawling' || scrapeState.status === 'cleaning') {
        return res.status(400).json({ error: 'Scraper is already busy' });
    }
    
    scrapeState = {
        status: 'cleaning',
        progress: 0,
        total: 0,
        currentJob: 'Starting cleanup...',
        logs: [],
        error: null
    };
    
    addLog('Triggered cleanup from Web UI');
    
    cleanupInactiveJobs(
        (msg) => addLog(msg),
        (prog) => {
            scrapeState.status = prog.status;
            scrapeState.progress = prog.progress;
            scrapeState.total = prog.total;
            scrapeState.currentJob = prog.currentJob;
        }
    ).then((jobs) => {
        scrapeState.status = 'completed';
        const inactiveCount = jobs.filter(j => j.active === false).length;
        scrapeState.currentJob = `Cleanup finished! ${inactiveCount} jobs marked as inactive.`;
        addLog(`Cleanup complete! Total jobs: ${jobs.length}, Inactive: ${inactiveCount}`);
    }).catch((err) => {
        scrapeState.status = 'error';
        scrapeState.error = err.message;
        scrapeState.currentJob = 'Error occurred during cleanup session.';
        addLog(`ERROR: ${err.message}`);
    });
    
    res.json({ success: true, message: 'Cleanup started in background' });
});

app.get('/api/scrape/results', (req, res) => {
    try {
        const config = loadConfig();
        const file = config.outputFile || path.join(__dirname, 'vdab_developer_jobs.json');
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            res.json(data);
        } else {
            res.json([]);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/scrape/check-session', async (req, res) => {
    try {
        const config = loadConfig();
        const headers = config.headers;
        const checkUrl = 'https://www.vdab.be/api/vindeenjob/bedrijvengalerij/randomBedrijven/13?toonAantalVacaturesEersteBedrijf=true';
        
        const response = await fetch(checkUrl, { headers });
        if (response.ok) {
            res.json({ loggedIn: true });
        } else {
            res.json({ loggedIn: false, status: response.status });
        }
    } catch (err) {
        res.json({ loggedIn: false, error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    console.log('\x1b[32m%s\x1b[0m', '  🚀 NODE APP IS RUNNING');
    console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    console.log(`  Motivation: \x1b[34mhttp://localhost:${PORT}/\x1b[0m`);
    console.log(`  CV (Standard): \x1b[34mhttp://localhost:${PORT}/cv\x1b[0m`);
    console.log(`  CV (Canva): \x1b[34mhttp://localhost:${PORT}/cv-canva\x1b[0m`);
    console.log(`  Scraper UI: \x1b[34mhttp://localhost:${PORT}/scraper\x1b[0m`);
    console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    console.log('  Press Ctrl+C to stop the server.');
});
