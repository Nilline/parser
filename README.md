# Coursebox Site Comparison Parser

Base parser for comparing Production vs Development sites before migration.

## Purpose

This tool validates that critical SEO elements remain consistent when migrating from the old site (Production - Webflow) to the new site (Development - Next.js on Vercel).

## What It Checks

The parser compares 5 essential SEO elements between Prod and Dev:

1. **URL Availability** - HTTP status codes (200, 404, etc.)
2. **Title Tags** - `<title>` content
3. **Meta Descriptions** - `<meta name="description">` content
4. **H1 Headings** - All `<h1>` tags on the page
5. **OG Images** - `<meta property="og:image">` URLs

## Installation

```bash
cd parser
npm install
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for detailed instructions on deploying to various hosting platforms (Render, Railway, Fly.io, DigitalOcean, VPS).

## Usage

### Web UI (Recommended)

Start the web server with a visual interface:

```bash
npm start
```

Then open http://localhost:3001 in your browser.

**Features:**
- Configure Prod/Dev URLs through the interface
- Edit URL list directly in the UI (saves to urls-main.txt)
- Live URL counter
- Select which elements to compare (Title, Description, H1, OG Image)
- Real-time progress tracking with live log updates
- Visual summary with color-coded results
- Direct links to HTML report (opens in new tab) and CSV download

**Execution time:** ~4-5 minutes (117 URLs × 1 second delay per site)

### CLI Mode (Original)

Run the parser from command line:

```bash
npm run parse
```

The parser will:
- Read URLs from `urls-main.txt` (117 URLs)
- Fetch each page from Prod and Dev
- Compare the 5 SEO elements
- Generate reports in `result/` directory

**Execution time:** ~4-5 minutes (117 URLs × 1 second delay)

### Sitemap Parser (Get All Pages)

Parse sitemap.xml to extract all unique pages:

```bash
npm run sitemap
```

**What it does:**
- Downloads sitemap.xml from https://www.coursebox.ai/sitemap.xml
- Filters English pages only (excludes /ar, /fr, etc.)
- Keeps 1 example per template (e.g., /rto-materials/[slug])
- Generates 2 files:
  - `result/webflow-pages.txt` - URL list (for parser)
  - `result/sitemap-stats.json` - Statistics

**Use cases:**
- Get complete list of unique Webflow pages
- Generate URL list for comparison parser
- Understand site structure and templates

**Execution time:** ~5-10 seconds (parses 500k lines)

**Filtering:**
- Excludes localized versions (25 languages)
- Keeps 1 example per template pattern
- Removes duplicate pages

## Configuration

### URLs to Check

Edit `urls-main.txt` to add/remove URLs. The file contains one URL per line:

```
/
/about
/pricing
/contact
/blog/1-on-1-coaching
/rto-materials/acm10121-certificate-i-in-animal-care-industry-pathways
/alternatives/1huddle-alternative
/ar
...
```

**Current list includes:**
- 113 main pages (features, pricing, about, etc.)
- 1 blog post example (to test blog template)
- 1 RTO materials example (to test RTO template)
- 1 alternative page example (to test alternatives template)
- 1 language version example (to test translations)

**Total: 116 URLs** (~4-5 minutes to check all)

### Sites Being Compared

- **Production:** https://www.coursebox.ai
- **Development:** https://coursebox-ai.vercel.app

To change these, edit `parser.js`:

```javascript
const PROD_URL = 'https://www.coursebox.ai';
const DEV_URL = 'https://coursebox-ai.vercel.app';
```

### Request Delay

Default: 1000ms (1 second) between requests to avoid server bans.

To change, edit `parser.js`:

```javascript
const DELAY_MS = 1000; // milliseconds
```

## Output

Two report files are generated in `result/` directory:

### 1. CSV Report (`comparison-report.csv`)

Spreadsheet format for data analysis. Contains:
- URL
- Status (OK / DIFF / ERROR)
- Differences count
- Prod vs Dev comparison for each element
- Match indicators (✅ / ❌)
- HTTP status codes
- Error messages (if any)

### 2. HTML Report (`comparison-report.html`)

Visual report with:
- Color-coded status badges
- Highlighted differences (red background)
- Summary statistics
- Sortable table
- Easy-to-read format

**Cells with differences are highlighted in red** for quick identification.

## Report Statuses

- **OK** - All elements match between Prod and Dev
- **DIFF** - Some elements differ (see highlighted cells)
- **ERROR** - Page failed to load (404, timeout, etc.)

## Example Output

```
Processing 113 URLs...
✅ / - OK (all match)
❌ /about - DIFF (Title, Description)
⚠️  /missing-page - ERROR (Dev: 404)
...

Summary:
Total URLs: 113
OK: 85
Differences: 23
Errors: 5
```

## File Structure

```
parser/
├── server.js              # Express server with Socket.io
├── parsers/               # Parser scripts
│   ├── parser.js          # Comparison parser (CLI)
│   ├── sitemap-parser.js  # Sitemap.xml parser
│   └── compare-urls.js    # URL list comparison tool
├── public/                # Web UI frontend
│   ├── index.html         # Main UI page
│   ├── styles.css         # Minimalist styling
│   └── app.js             # Socket.io client
├── data/                  # Data files
│   ├── sitemap.xml        # Production sitemap
│   ├── sitemap-dev.xml    # Dev sitemap
│   └── sitemap-dev-pages.xml
├── result/                # Generated reports (gitignored)
│   ├── comparison-report.csv
│   ├── comparison-report.html
│   ├── webflow-pages.txt  # Sitemap parser output
│   └── sitemap-stats.json # Sitemap statistics
├── urls-main.txt          # List of URLs to check (117 URLs)
├── package.json           # npm configuration
└── README.md              # This file
```

## Troubleshooting

### "Cannot find module 'axios'"

Run `npm install` to install dependencies.

### "ECONNREFUSED" or timeout errors

- Check your internet connection
- Verify Dev site is deployed: https://coursebox-ai.vercel.app
- Increase timeout in `parser.js` (default: 10000ms)

### "Too many requests" or 429 errors

Increase `DELAY_MS` in `parser.js` to wait longer between requests.

### Empty reports

- Verify `urls-main.txt` exists and contains URLs
- Check that URLs start with `/` (e.g., `/about` not `about`)

## Technical Details

### Backend
- **Language:** Node.js (JavaScript)
- **Web Server:** Express.js
- **Real-time:** Socket.io for live progress updates
- **HTTP Client:** axios
- **HTML Parser:** cheerio (jQuery-like syntax)
- **CSV Writer:** csv-writer

### Frontend
- **UI:** Vanilla HTML/CSS/JS (no frameworks)
- **Real-time:** Socket.io client
- **Design:** Minimalist business style

### Configuration
- **Rate Limiting:** 1 second delay between requests
- **Timeout:** 10 seconds per request
- **User-Agent:** `Coursebox-Migration-Parser/1.0`
- **Port:** 3001 (configurable via PORT env variable)

## Future Improvements

This is the **base version** of the parser. Planned enhancements:

- Add canonical URL validation
- Check hreflang tags for multi-language support
- Validate structured data (Schema.org)
- Compare image counts and sizes
- Add parallel processing for faster execution
- GitLab CI/CD integration for automated testing
- Diff visualization showing exact changes

## Support

For issues or questions, contact the Coursebox development team.
