const { runScrape } = require('./scraper_helper');

runScrape(
    (msg) => console.log(msg),
    () => {}
).catch(err => {
    console.error('Fatal error during scraping process:', err);
    process.exit(1);
});
