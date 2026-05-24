const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;

// Serve static files
app.use(express.static(__dirname));

// Main entry points
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'motivatie.html')));
app.get('/cv', (req, res) => res.sendFile(path.join(__dirname, 'cv-a4.html')));
app.get('/cv-canva', (req, res) => res.sendFile(path.join(__dirname, 'cv-a4-canva.html')));

app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    console.log('\x1b[32m%s\x1b[0m', '  🚀 CV APP IS RUNNING');
    console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    console.log(`  Motivation: \x1b[34mhttp://localhost:${PORT}/\x1b[0m`);
    console.log(`  CV (Standard): \x1b[34mhttp://localhost:${PORT}/cv\x1b[0m`);
    console.log(`  CV (Canva): \x1b[34mhttp://localhost:${PORT}/cv-canva\x1b[0m`);
    console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    console.log('  Press Ctrl+C to stop the server.');
});
