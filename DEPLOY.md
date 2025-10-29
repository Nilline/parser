# Deployment Guide

This guide explains how to deploy the Coursebox Parser to various hosting platforms.

## 📋 Prerequisites

Before deploying:
- Git repository with parser code
- Node.js 20.x or higher
- All dependencies installed (`npm install`)

## 🚀 Deployment Options

### Option 1: Render.com (Recommended - Free Tier Available)

**Why Render:**
- Free tier available (no credit card required)
- Easy deployment from Git
- Automatic SSL
- Good for long-running processes
- WebSocket support (Socket.io)

**Steps:**

1. **Create Render Account**
   - Go to https://render.com
   - Sign up (free)

2. **Create New Web Service**
   - Dashboard → "New +"
   - Select "Web Service"
   - Connect your Git repository

3. **Configuration**
   - **Name:** `coursebox-parser`
   - **Region:** Choose closest to your users
   - **Branch:** `main` or your branch name
   - **Root Directory:** `parser` (if parser is in subdirectory)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`

4. **Environment Variables**
   - `PORT` - Render sets this automatically (leave empty)
   - `NODE_ENV` - `production` (optional)

5. **Deploy**
   - Click "Create Web Service"
   - Wait ~3-5 minutes for build
   - Your app will be at: `https://coursebox-parser.onrender.com`

**Free Tier Limitations:**
- Service spins down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- 750 hours/month free (enough for 24/7 if only one service)

**Cost for Always-On:**
- Starter: $7/month (no spin-down)

---

### Option 2: Railway.app (Free $5 Credit Monthly)

**Why Railway:**
- $5 free credit per month (no credit card for trial)
- Simple deployment
- Excellent developer experience
- WebSocket support

**Steps:**

1. **Create Railway Account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Deploy from GitHub**
   - Dashboard → "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configuration**
   - Railway auto-detects Node.js
   - No build command needed
   - Start command: `npm start`

4. **Root Directory (if needed)**
   - Settings → "Root Directory" → `parser`

5. **Environment Variables**
   - Settings → "Variables"
   - Add: `NODE_ENV=production`

6. **Generate Domain**
   - Settings → "Generate Domain"
   - Your app will be at: `https://coursebox-parser.up.railway.app`

**Free Tier:**
- $5 credit/month
- ~500 hours of runtime
- Enough for testing/development

**Cost:**
- Usage-based pricing (~$5-20/month for production)

---

### Option 3: Fly.io (Free Allowance)

**Why Fly.io:**
- Generous free tier
- Good performance
- Close to metal
- WebSocket support

**Steps:**

1. **Install Fly CLI**
   ```bash
   # Windows
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

   # Mac/Linux
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login**
   ```bash
   fly auth login
   ```

3. **Navigate to Parser Directory**
   ```bash
   cd parser
   ```

4. **Initialize App**
   ```bash
   fly launch
   ```

   Answer prompts:
   - App name: `coursebox-parser`
   - Region: Choose closest
   - PostgreSQL: No
   - Redis: No
   - Deploy now: Yes

5. **Deploy Updates**
   ```bash
   fly deploy
   ```

**Free Tier:**
- 3 shared-cpu-1x VMs with 256MB RAM each
- 160GB outbound data transfer
- Enough for most parsing workloads

**Cost:**
- Pay-as-you-go after free tier

---

### Option 4: DigitalOcean App Platform ($5/month)

**Why DigitalOcean:**
- Simple, reliable
- Fixed pricing
- Good for production

**Steps:**

1. **Create DigitalOcean Account**
   - Go to https://www.digitalocean.com
   - Sign up (gets $200 credit for 60 days)

2. **Create App**
   - App Platform → "Create App"
   - Connect GitHub repo

3. **Configuration**
   - **Source Directory:** `parser` (if in subdirectory)
   - **Build Command:** `npm install`
   - **Run Command:** `npm start`
   - **HTTP Port:** 3001 (or use PORT env variable)

4. **Plan Selection**
   - Basic: $5/month
   - Professional: $12/month (recommended for production)

**Cost:**
- $5/month minimum (Basic plan)
- $12/month for better performance

---

### Option 5: VPS (Full Control)

**Recommended VPS Providers:**
- DigitalOcean Droplets ($4-6/month)
- Linode ($5/month)
- Vultr ($5/month)
- Hetzner ($4/month, Europe)

**Steps:**

1. **Create VPS**
   - Ubuntu 22.04 LTS
   - 1GB RAM minimum
   - 25GB storage

2. **Connect via SSH**
   ```bash
   ssh root@your-ip
   ```

3. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

4. **Install PM2 (Process Manager)**
   ```bash
   sudo npm install -g pm2
   ```

5. **Clone Repository**
   ```bash
   cd /var/www
   git clone <your-repo-url>
   cd coursebox-landing-site/parser
   npm install
   ```

6. **Start with PM2**
   ```bash
   pm2 start npm --name "parser" -- start
   pm2 save
   pm2 startup
   ```

7. **Setup Nginx (Optional - for domain)**
   ```bash
   sudo apt install nginx
   sudo nano /etc/nginx/sites-available/parser
   ```

   Add:
   ```nginx
   server {
       listen 80;
       server_name parser.yourdomain.com;

       location / {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

   Enable:
   ```bash
   sudo ln -s /etc/nginx/sites-available/parser /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

8. **SSL with Certbot (Optional)**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d parser.yourdomain.com
   ```

**Cost:**
- $4-6/month for basic VPS
- Full control over server

---

## ⚠️ NOT Recommended

### Vercel / Netlify

**Why not:**
- Designed for serverless functions (10-60 second timeouts)
- Parser can run for 4-5 minutes per scan (117 URLs)
- WebSocket support is limited or requires extra configuration
- Not suitable for long-running processes

---

## 🔧 Configuration for Production

### Environment Variables

Set these on your hosting platform:

```bash
# Required
PORT=3001                    # Port for web server (some hosts auto-set this)
NODE_ENV=production         # Production mode

# Optional
DELAY_MS=1000               # Delay between requests (default: 1000ms)
```

### Update URLs in Code

If you want to change default URLs, edit `server.js`:

```javascript
app.get('/api/config', (req, res) => {
  res.json({
    prodUrl: process.env.PROD_URL || 'https://www.coursebox.ai',
    devUrl: process.env.DEV_URL || 'https://coursebox-ai.vercel.app',
    // ...
  });
});
```

Then set environment variables:
```bash
PROD_URL=https://www.coursebox.ai
DEV_URL=https://dev.coursebox.ai
```

---

## 📊 Comparison Table

| Platform | Free Tier | Cost/Month | Ease of Setup | Best For |
|----------|-----------|------------|---------------|----------|
| **Render** | ✅ Yes (with spin-down) | $0-7 | ⭐⭐⭐⭐⭐ Very Easy | Testing, Small Teams |
| **Railway** | ✅ $5 credit | $5-20 | ⭐⭐⭐⭐⭐ Very Easy | Development |
| **Fly.io** | ✅ Generous | $0-10 | ⭐⭐⭐⭐ Easy | Production |
| **DigitalOcean** | ✅ $200/60d | $5+ | ⭐⭐⭐⭐ Easy | Production |
| **VPS** | ❌ No | $4-6 | ⭐⭐⭐ Medium | Full Control |

---

## 🎯 Recommended Setup

**For Testing/Development:**
- **Render.com** (free tier) - Easiest setup, no credit card needed

**For Production:**
- **Railway.app** - Simple, affordable, good DX
- **Fly.io** - Best performance/price ratio
- **DigitalOcean** - Fixed pricing, reliable

**For High Volume (1M+ URLs/day):**
- **VPS** - Full control, can scale vertically

---

## 🔒 Security Notes

1. **Don't commit .env files** - Use platform environment variables
2. **Use HTTPS** - All recommended platforms provide free SSL
3. **Restrict access** - Add basic auth if needed (not included in current version)
4. **Rate limiting** - Current 1 second delay is safe, don't decrease
5. **Monitor usage** - Set up alerts for unexpected traffic

---

## 📝 Post-Deployment Checklist

- [ ] App is accessible at provided URL
- [ ] UI loads correctly
- [ ] Can connect to Socket.io (check status indicator)
- [ ] Can edit URL list
- [ ] Can save URL list changes
- [ ] Can start parser comparison
- [ ] Real-time progress updates work
- [ ] Reports generate successfully (CSV + HTML)
- [ ] Report links work (download CSV, view HTML)

---

## 🆘 Troubleshooting

### "Cannot connect to server"
- Check if service is running
- Verify PORT environment variable
- Check platform logs

### "WebSocket error"
- Ensure platform supports WebSockets
- Check firewall rules
- Verify Socket.io is running

### "Parser times out"
- Increase platform timeout limits
- Reduce number of URLs in list
- Consider deploying to VPS for longer runs

### "Out of memory"
- Upgrade to plan with more RAM
- Current app needs ~256-512MB RAM for 117 URLs

---

## 📞 Support

For deployment issues:
1. Check platform documentation
2. Review platform logs
3. Test locally first: `npm start` → http://localhost:3001

---

## 🚀 Quick Start (Render.com)

**Fastest way to get running:**

1. Push code to GitHub
2. Go to https://render.com
3. Sign up (no credit card needed)
4. "New +" → "Web Service"
5. Connect GitHub repo
6. Set root directory: `parser`
7. Build: `npm install`
8. Start: `npm start`
9. Click "Create Web Service"
10. Wait 3-5 minutes
11. Done! 🎉

Your parser will be live at: `https://[your-app-name].onrender.com`
