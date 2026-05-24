# VDAB-Scraper

A powerful, reverse-engineered automated scraper and dashboard for extracting job vacancies from VDAB.

## 🚀 Features

- **API-based Extraction:** Efficiently pulls data from VDAB's internal APIs.
- **Dynamic Dashboard:** Real-time monitoring of scraping progress, stats, and live terminal logs.
- **Smart Merging:** Automatically merges new vacancies with existing ones, preventing duplicates.
- **Cleanup Tool:** Verifies if scraped vacancies are still active on VDAB and marks inactive ones.
- **Advanced Filtering:** Live search and exclude keywords (e.g., filter out "business" or "sales" roles).
- **Firefox Cookie Sync:** One-click session synchronization by reading local Firefox cookie databases.
- **Export Options:** Download your data as JSON or CSV.

## 🛠️ Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla JS, CSS (Glassmorphism UI)
- **Database:** Local JSON storage

## 📦 Installation

1. Clone the repository.
2. Run `npm install`.
3. Start the server with `npm start`.
4. Navigate to `http://localhost:8080/scraper`.

## 🦊 Cookie Sync (Linux)

The scraper requires an active VDAB session. For Firefox users on Linux, the dashboard can automatically detect and import your cookies if you are logged in at `vdab.be`.

---

*Note: This project is for educational/personal use. Please respect VDAB's terms of service and usage limits.*
