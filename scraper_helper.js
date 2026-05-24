const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const BASE_URL = 'https://www.vdab.be/rest/vindeenjob/v4';
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_OUTPUT_FILE = path.join(__dirname, 'vdab_developer_jobs.json');
const DELAY_MS = 2000;

const LIMBURG_CITIES = new Set([
    'HASSELT', 'GENK', 'DIEPENBEEK', 'MAASMECHELEN', 'LOMMEL', 'BERINGEN', 
    'SINT-TRUIDEN', 'TONGEREN', 'LANAKEN', 'MAASEIK', 'ZONHOVEN', 'HEUSDEN-ZOLDER', 
    'HOUTHALEN-HELCHTEREN', 'PEER', 'BREE', 'DILSEN-STOKKEM', 'RIEMST', 
    'TESSENDERLO', 'BILZEN', 'PELT', 'HAMONT-ACHEL', 'AS', 'ALKEN', 'BOCHOLT', 
    'BORGLOON', 'GINGELOM', 'HALEN', 'HAM', 'HECHTEL-EKSEL', 'HERSTAPPE', 
    'HOESELT', 'KINROOI', 'KORTESSEM', 'LEOPOLDSBURG', 'LUMMEN', 'NIEUWERKERKEN', 
    'OUDSBERGEN', 'WELLEN', 'ZUTENDAAL', 'MAASTRICHT'
]);

function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error(`Config file not found at ${CONFIG_FILE}. Please create it first.`);
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 3, delay = 2000, onLog = console.log) {
    try {
        const response = await fetch(url, options);
        return response;
    } catch (err) {
        if (retries <= 0) {
            throw err;
        }
        onLog(`Fetch failed to ${url}. Retrying in ${delay}ms... (${retries} retries left). Error: ${err.message}`);
        await sleep(delay);
        return fetchWithRetry(url, options, retries - 1, delay * 2, onLog);
    }
}

function extractTechnologies(text) {
    if (!text) return [];
    const techKeywords = [
        'javascript', 'typescript', 'react', 'angular', 'vue', 'node', 'express', 
        'python', 'django', 'flask', 'java', 'spring', 'kotlin', 'c#', '.net', 
        'dotnet', 'php', 'laravel', 'symfony', 'ruby', 'rails', 'go', 'golang', 
        'rust', 'sql', 'mysql', 'postgresql', 'mongodb', 'docker', 'kubernetes', 
        'aws', 'azure', 'devops', 'html', 'css', 'sass', 'git'
    ];
    
    const words = text.toLowerCase().split(/[\s,./()]+/);
    const found = new Set();
    
    for (const word of words) {
        if (techKeywords.includes(word)) {
            if (word === 'node') found.add('Node.js');
            else if (word === 'c#') found.add('C#');
            else if (word === '.net' || word === 'dotnet') found.add('.NET');
            else if (word === 'golang') found.add('Go');
            else if (word === 'html') found.add('HTML');
            else if (word === 'css') found.add('CSS');
            else found.add(word.charAt(0).toUpperCase() + word.slice(1));
        }
    }
    return Array.from(found);
}

async function runScrape(onLog = console.log, onProgress = () => {}) {
    onLog('Loading configurations...');
    const config = loadConfig();
    const headers = config.headers;
    const outputFile = config.outputFile || DEFAULT_OUTPUT_FILE;
    
    let allResults = [];
    let currentPage = 0;
    let totalPages = 1;
    let totalRecords = 0;
    
    onLog(`Starting search for developer jobs with query: "${config.trefwoord || 'developer'}"...`);
    onProgress({ status: 'searching', progress: 0, total: 0, currentJob: 'Retrieving job list...' });
    
    do {
        onLog(`Fetching search results page ${currentPage}...`);
        const response = await fetchWithRetry(`${BASE_URL}/vacatureLight/zoek`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                criteria: {
                    trefwoord: config.trefwoord || 'developer'
                },
                pagina: currentPage,
                zoekmodus: 'C2'
            })
        }, 3, 2000, onLog);
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Search request failed with status ${response.status}: ${errText.slice(0, 300)}`);
        }
        
        const data = await response.json();
        totalRecords = data.totaalAantal || 0;
        const paginaGrootte = data.paginaGrootte || 15;
        totalPages = Math.ceil(totalRecords / paginaGrootte);
        
        const pageResults = data.resultaten || [];
        allResults = allResults.concat(pageResults);
        
        onLog(`  Retrieved ${pageResults.length} jobs. Progress: ${allResults.length}/${totalRecords}`);
        onProgress({ 
            status: 'searching', 
            progress: allResults.length, 
            total: totalRecords, 
            currentJob: `Fetched ${allResults.length} of ${totalRecords} jobs from search...` 
        });
        
        if (currentPage + 1 < totalPages) {
            await sleep(DELAY_MS);
        }
        currentPage++;
        
        const maxPages = config.maxPages || 10;
        if (currentPage >= maxPages) {
            onLog(`Reached safety limit of ${maxPages} pages. Stopping search page fetching.`);
            break;
        }
        
    } while (currentPage < totalPages);
    
    onLog(`Search complete. Total vacancies collected: ${allResults.length}`);
    
    let filteredResults = allResults;
    if (config.filterLimburg === true) {
        onLog('Filtering jobs for Limburg (BE) & Maastricht (NL)...');
        filteredResults = allResults.filter(job => {
            const city = (job.tewerkstellingsLocatieRegioOfAdres || '').toUpperCase().trim();
            return LIMBURG_CITIES.has(city);
        });
        onLog(`Filtered down to ${filteredResults.length} jobs in target locations.`);
    } else {
        onLog('Limburg filter is disabled. Processing all collected jobs.');
    }
    
    const scrapedJobs = [];
    const totalToProcess = filteredResults.length;
    
    onProgress({ status: 'crawling', progress: 0, total: totalToProcess, currentJob: 'Starting details fetch...' });
    
    for (let i = 0; i < totalToProcess; i++) {
        const job = filteredResults[i];
        const id = job.id.id;
        const title = job.vacaturefunctie?.naam || 'No Title';
        onLog(`[${i + 1}/${totalToProcess}] Fetching details for vacancy ID: ${id} (${title})...`);
        onProgress({ status: 'crawling', progress: i, total: totalToProcess, currentJob: title });
        
        try {
            const res = await fetchWithRetry(`${BASE_URL}/vacatures/${id}?preview=false`, {
                headers
            }, 3, 2000, onLog);
            
            if (!res.ok) {
                onLog(`  Failed to fetch details for ${id}: HTTP ${res.status}`);
                continue;
            }
            
            const detail = await res.json();
            
            const jobDesc = detail.functie?.omschrijving?.plainText || '';
            const jobReqs = detail.profiel?.vereisteKwalificaties?.plainText || '';
            const fullText = `${jobDesc} ${jobReqs}`;
            const technologies = extractTechnologies(fullText);
            
            const licenses = detail.profiel?.rijbewijzen || [];
            const hasLicenseB = licenses.some(lic => (lic.code || '').toUpperCase() === 'B');
            
            scrapedJobs.push({
                id,
                title: detail.functie?.naam || job.vacaturefunctie?.naam,
                company: detail.leverancier?.naam || job.vacatureBedrijfsnaam,
                location: detail.jobPosting ? JSON.parse(detail.jobPosting).jobLocation?.[0]?.address?.addressLocality : job.tewerkstellingsLocatieRegioOfAdres,
                postalCode: detail.jobPosting ? JSON.parse(detail.jobPosting).jobLocation?.[0]?.address?.postalCode : null,
                postedDate: detail.eerstePublicatieDatum || job.eerstePublicatieDatum,
                description: jobDesc,
                requirements: jobReqs,
                drivingLicenseRequired: hasLicenseB,
                drivingLicenses: licenses.map(lic => lic.label),
                technologies,
                originalJob: job
            });
            
        } catch (err) {
            onLog(`  Error processing detail for ${id}: ${err.message}`);
        }
        
        if (i < totalToProcess - 1) {
            await sleep(DELAY_MS);
        }
    }
    
    onLog(`Saving ${scrapedJobs.length} processed developer jobs to ${outputFile}...`);
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    let finalJobs = scrapedJobs;
    if (fs.existsSync(outputFile)) {
        onLog('Existing file found. Merging new results...');
        try {
            const existingData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
            if (Array.isArray(existingData)) {
                const existingIds = new Set(existingData.map(j => j.id));
                const uniqueNewJobs = scrapedJobs.filter(j => !existingIds.has(j.id));
                onLog(`  Found ${uniqueNewJobs.length} new unique jobs to add.`);
                finalJobs = [...existingData, ...uniqueNewJobs];
            }
        } catch (err) {
            onLog(`  Warning: Could not parse existing file (${err.message}). Proceeding with fresh save.`);
        }
    }

    fs.writeFileSync(outputFile, JSON.stringify(finalJobs, null, 2));
    onLog(`Scraping session completed. Total jobs in file: ${finalJobs.length}`);
    onProgress({ status: 'completed', progress: totalToProcess, total: totalToProcess, currentJob: 'Success! Results merged and saved.' });
    
    return finalJobs;
}

async function cleanupInactiveJobs(onLog = console.log, onProgress = () => {}) {
    onLog('Starting cleanup of inactive jobs...');
    const config = loadConfig();
    const headers = config.headers;
    const outputFile = config.outputFile || DEFAULT_OUTPUT_FILE;

    if (!fs.existsSync(outputFile)) {
        onLog('No jobs file found to cleanup.');
        return [];
    }

    let jobs = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    if (!Array.isArray(jobs)) return [];

    onLog(`Checking ${jobs.length} jobs for availability...`);
    let inactiveCount = 0;
    let checkedCount = 0;

    for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        
        // Skip jobs already marked as inactive if we want, but checking them again is safer
        // if (job.active === false) continue; 

        onProgress({ status: 'cleaning', progress: i, total: jobs.length, currentJob: `Checking: ${job.title}` });

        try {
            const res = await fetchWithRetry(`${BASE_URL}/vacatures/${job.id}?preview=false`, {
                headers
            }, 1, 1000, onLog); // Fewer retries for cleanup
            
            const wasActive = job.active !== false;
            if (res.status === 404) {
                job.active = false;
                if (wasActive) inactiveCount++;
            } else if (res.ok) {
                job.active = true;
            }
            
            checkedCount++;
        } catch (err) {
            onLog(`  Error checking ${job.id}: ${err.message}`);
        }

        if (i < jobs.length - 1) {
            await sleep(500); // Faster check for cleanup
        }
    }

    fs.writeFileSync(outputFile, JSON.stringify(jobs, null, 2));
    onLog(`Cleanup complete. Marked ${inactiveCount} new jobs as inactive.`);
    onProgress({ status: 'completed', progress: jobs.length, total: jobs.length, currentJob: `Cleanup done. Found ${inactiveCount} inactive.` });

    return jobs;
}

function findFirefoxCookieDb() {
    const home = os.homedir();
    const possiblePaths = [
        path.join(home, '.config/mozilla/firefox'),
        path.join(home, '.mozilla/firefox'),
        path.join(home, 'snap/firefox/common/.mozilla/firefox'),
        path.join(home, '.var/app/org.mozilla.firefox/.mozilla/firefox')
    ];
    
    let bestDbPath = null;
    let bestMtime = 0;
    
    for (const basePath of possiblePaths) {
        if (!fs.existsSync(basePath)) continue;
        
        try {
            const files = fs.readdirSync(basePath);
            for (const file of files) {
                const fullPath = path.join(basePath, file);
                const stats = fs.statSync(fullPath);
                
                if (stats.isDirectory()) {
                    const dbPath = path.join(fullPath, 'cookies.sqlite');
                    if (fs.existsSync(dbPath)) {
                        const dbStats = fs.statSync(dbPath);
                        if (dbStats.mtimeMs > bestMtime) {
                            bestMtime = dbStats.mtimeMs;
                            bestDbPath = dbPath;
                        }
                    }
                }
            }
        } catch (err) {
            // Ignore directory read errors
        }
    }
    
    return bestDbPath;
}

function extractFirefoxCookies(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) {
        throw new Error('Firefox cookies database not found.');
    }
    
    // Copy to temporary location to avoid database locks
    const tempDbPath = path.join(os.tmpdir(), `vdab_cookies_${Date.now()}.sqlite`);
    fs.copyFileSync(dbPath, tempDbPath);
    
    try {
        const query = "SELECT name, value FROM moz_cookies WHERE host LIKE '%vdab.be'";
        let cookiesData = [];
        try {
            const output = execSync(`sqlite3 -json ${tempDbPath} "${query}"`, { encoding: 'utf8' }).trim();
            if (output) {
                cookiesData = JSON.parse(output);
            }
        } catch (err) {
            // Fallback for older sqlite3 versions without -json support:
            const output = execSync(`sqlite3 -list -separator '|' ${tempDbPath} "${query}"`, { encoding: 'utf8' }).trim();
            if (output) {
                const lines = output.split('\n');
                for (const line of lines) {
                    const parts = line.split('|');
                    if (parts.length >= 2) {
                        cookiesData.push({ name: parts[0], value: parts[1] });
                    }
                }
            }
        }
        
        if (cookiesData.length === 0) {
            throw new Error('No vdab.be cookies found in your active Firefox profile. Make sure you are logged into vdab.be in Firefox.');
        }
        
        const cookieString = cookiesData.map(c => `${c.name}=${c.value}`).join('; ');
        return cookieString;
        
    } finally {
        try {
            if (fs.existsSync(tempDbPath)) {
                fs.unlinkSync(tempDbPath);
            }
        } catch (err) {
            // Ignore cleanup error
        }
    }
}

module.exports = {
    runScrape,
    cleanupInactiveJobs,
    loadConfig,
    CONFIG_FILE,
    findFirefoxCookieDb,
    extractFirefoxCookies
};
