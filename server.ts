import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer";
import cors from "cors";
import * as dotenv from "dotenv";
import { initializeApp, getApps, getApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import cron from "node-cron";
import fs from "fs";
import QRCode from "qrcode";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Lazy Firebase Admin Initialization
  let _db: any = null;
  const getDb = () => {
    if (_db) return _db;
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      console.log(`[FIREBASE] Looking for config at: ${configPath}`);
      const configExists = fs.existsSync(configPath);
      let config: any = {};
      
      if (configExists) {
        try {
          const content = fs.readFileSync(configPath, "utf-8");
          config = JSON.parse(content);
          console.log(`[FIREBASE] Config loaded. ID: ${config.firestoreDatabaseId || '(default)'}`);
        } catch (e) {
          console.error(`[FIREBASE] Error parsing config file:`, e);
        }
      } else {
        console.warn(`[FIREBASE] config file NOT FOUND at ${configPath}. Using defaults.`);
      }
      
      const apps = getApps();
      let firebaseApp;
      
      const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GCP_PROJECT_ID;
      const configProjectId = config.projectId;
      
      // CRITICAL: Explicitly provide project ID if we have it in config.
      // Sometimes applicationDefault() auto-detection fails in certain environments.
      const targetProjectId = configProjectId || envProjectId || undefined;

      if (apps.length === 0) {
        try {
          console.log(`[FIREBASE] Initializing Admin SDK. Project: ${targetProjectId || 'auto-detect'}`);
          firebaseApp = initializeApp({
            credential: applicationDefault(),
            projectId: targetProjectId
          });
        } catch (initErr: any) {
          console.error("[FIREBASE] initializeApp failed, trying blind initialization:", initErr.message);
          firebaseApp = initializeApp();
        }
      } else {
        firebaseApp = apps[0];
      }

      // Check if we have a custom database ID
      const dbId = config.firestoreDatabaseId;
      if (dbId && dbId !== "(default)" && !process.env.FORCE_DEFAULT_DB) {
        console.log(`[FIREBASE] Attempting to use database: ${dbId} in project ${firebaseApp.options.projectId || 'auto'}`);
        try {
          _db = getFirestore(firebaseApp, dbId);
        } catch (dbErr) {
          console.error(`[FIREBASE] Failed to get database ${dbId}, falling back to default`, dbErr);
          _db = getFirestore(firebaseApp);
        }
      } else {
        console.log(`[FIREBASE] Using (default) database in project ${firebaseApp.options.projectId || 'auto'}`);
        _db = getFirestore(firebaseApp);
      }
      
      return _db;
    } catch (err) {
      console.error("[FIREBASE ERROR] Major initialization failure:", err);
      return null;
    }
  };

  // Re-verify on startup with detailed error
  const dbTest = getDb();
  if (dbTest) {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const dbId = fs.existsSync(configPath) 
      ? JSON.parse(fs.readFileSync(configPath, "utf-8")).firestoreDatabaseId
      : "(default)";

    console.log(`[FIREBASE] Attempting startup ping on database: ${dbId || '(default)'}`);
    dbTest.collection('system').doc('ping').set({ 
      lastPing: FieldValue.serverTimestamp(),
      nodeVersion: process.version,
      databaseId: dbId || '(default)'
    }, { merge: true })
      .then(() => console.log(`[FIREBASE] Initial ping SUCCESS on ${dbId || '(default)'}`))
      .catch(async (e: any) => {
        console.error(`[FIREBASE] Initial ping FAILED on ${dbId || '(default)'}:`, e.message);
        
      // Try to clear the global error if we've already fallen back
      if (e.code === 7 || e.code === 5 || e.message?.includes('PERMISSION_DENIED') || e.message?.includes('NOT_FOUND')) {
        const errType = e.code === 5 ? 'NOT_FOUND' : 'PERMISSION_DENIED';
        const activeProject = getApps().length > 0 ? getApps()[0].options.projectId : 'auto';
        console.warn(`[FIREBASE] Startup ping failed with ${errType}. Database: ${dbId || '(default)'}. Project: ${activeProject}`);
        
        if (dbId && dbId !== "(default)") {
          console.log("[FIREBASE] Attempting emergency fallback to (default) database...");
          try {
            const fallbackDb = getFirestore(getApps()[0]);
            _db = fallbackDb; // Update the cached database instance globally
            
            await fallbackDb.collection('system').doc('ping_fallback').set({ 
              lastPing: FieldValue.serverTimestamp(),
              originalFailedDb: dbId,
              failureCode: e.code,
              failureMessage: e.message,
              msg: `Auto-fallback to default database due to ${errType} on startup`
            }, { merge: true });
            console.log("[FIREBASE] Fallback ping SUCCESS. All future Firestore calls will use the (default) database.");
          } catch (fe: any) {
             console.error("[FIREBASE] Fallback ping also FAILED. Project might not have Firestore enabled:", fe.message);
          }
        }
      }
    });
  }

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  // Gemini Initialization
  const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // Build Versioning for Automatic Updates
  const BUILD_ID = process.env.BUILD_ID || new Date().toISOString();

  app.get("/api/version", (req, res) => {
    res.json({ 
      version: BUILD_ID,
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // API Route for invoice scanning
  app.post("/api/distributor/scan-invoice", async (req, res) => {
    const { image, distributorName, existingItems } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    try {
      console.log(`[SCANNER] Scanning invoice for ${distributorName}`);
      
      const itemsList = existingItems && Array.isArray(existingItems) 
        ? existingItems.map((i: any) => `- ${i.n} (Current Cost: $${i.c}, Size: ${i.sz}, Unit: ${i.u})`).join('\n')
        : distributorName;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                text: `You are an expert invoice processing assistant for a bar/restaurant. 
                Extract all line items from this invoice for the distributor "${distributorName}".
                
                Our existing inventory items for this distributor are:
                ${itemsList}
 
                For each item on the invoice, identify:
                - Product Name (Ideally matching one of our existing items above if applicable)
                - Unit Cost/Price (MUST be the cost PER INDIVIDUAL ITEM in our inventory. If the invoice shows a case price for 24 items, divide the case price by 24 to get the unit cost for our inventory).
                - Size (e.g. 12oz, 1L, etc.)
                - Quantity (how many units were delivered)
                - Unit type (e.g. case, bottle, 12pk, etc.)
                
                If the item on the invoice is a bulk box/case but our inventory tracks individual bottles, you MUST calculate the "price" as the cost per individual bottle.
                
                Return the data as a JSON object with an "items" array.
                If you are unsure of a field, provide your best guess based on keywords.
                JSON structure: { "items": [ { "name": string, "price": number, "size": string, "quantity": number, "unit": string } ] }`
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: image.split(',')[1] || image // Assuming base64 data URI
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const extracted = JSON.parse(response.text);

      // Save a system copy of both the image file and the extracted JSON
      let localUrl = null;
      try {
        const scansDir = path.join(process.cwd(), "scanned_invoices");
        if (!fs.existsSync(scansDir)) {
          fs.mkdirSync(scansDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const safeDistName = (distributorName || "unknown").replace(/[^a-z0-9]/gi, "_").toLowerCase();

        // Save scanned image to filesystem
        let ext = "jpg";
        let cleanBase64 = image;
        if (image.includes(";base64,")) {
          const parts = image.split(";base64,");
          ext = parts[0].split("/")[1] || "jpg";
          if (ext.includes(";")) ext = ext.split(";")[0];
          cleanBase64 = parts[1];
        }

        const buffer = Buffer.from(cleanBase64, "base64");
        const imgFilename = `invoice-${safeDistName}-${timestamp}.${ext}`;
        const imgPath = path.join(scansDir, imgFilename);
        fs.writeFileSync(imgPath, buffer);
        console.log(`[SCANNER] Successfully saved copy of image to system disk: ${imgFilename}`);

        localUrl = `/api/scans/invoice/${imgFilename}`;

        // Save extracted items metadata to filesystem alongside the image
        const jsonFilename = `invoice-${safeDistName}-${timestamp}.json`;
        const jsonPath = path.join(scansDir, jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify({
          distributor: distributorName,
          timestamp: new Date().toISOString(),
          imageFile: imgFilename,
          extractedItems: extracted
        }, null, 2));
        console.log(`[SCANNER] Successfully saved copy of extraction data to system disk: ${jsonFilename}`);
      } catch (saveErr) {
        console.error("[SCANNER COPY ERROR] Failed to save copy of scanned invoice to disk:", saveErr);
      }

      res.json({
        ...extracted,
        localUrl
      });
    } catch (error) {
      console.error("[SCANNER ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API Route to deliver saved copies of scanned invoice images from local filesystem
  app.get("/api/scans/invoice/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      const safeFilename = path.basename(filename); // Prevent Directory Traversal
      const filePath = path.join(process.cwd(), "scanned_invoices", safeFilename);

      if (fs.existsSync(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: "Invoice file copy not found on server disk" });
      }
    } catch (err) {
      console.error("[SERVE SCANS ERROR]", err);
      res.status(500).json({ error: "Internal server error serving invoice file copy" });
    }
  });

  // QuickBooks Token Storage (Mock - should be in database)
  let qbTokens: { access_token: string; refresh_token: string; realmId: string } | null = null;

  // API Route for QuickBooks Auth URL
  app.get("/api/auth/quickbooks/url", (req, res) => {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/quickbooks/callback`;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    
    if (!clientId) {
      return res.status(400).json({ error: "QUICKBOOKS_CLIENT_ID is not configured" });
    }

    const authEndpoint = environment === 'sandbox' 
      ? 'https://appcenter.intuit.com/connect/oauth2' 
      : 'https://appcenter.intuit.com/connect/oauth2';

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payroll',
      redirect_uri: redirectUri,
      state: 'se_qb_auth'
    });

    res.json({ url: `${authEndpoint}?${params.toString()}` });
  });

  // QuickBooks Authorization Callback
  app.get(["/auth/quickbooks/callback", "/auth/quickbooks/callback/"], async (req, res) => {
    const { code, realmId, error } = req.query;

    if (error) {
      return res.send(`<html><body><script>window.opener.postMessage({ type: 'QB_AUTH_ERROR', error: '${error}' }, '*'); window.close();</script></body></html>`);
    }

    if (!code) {
      return res.status(400).send("Authorization code missing");
    }

    // Exchange code for tokens
    try {
      const clientId = process.env.QUICKBOOKS_CLIENT_ID;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
      const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/quickbooks/callback`;
      
      const tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
      
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error_description || 'Token exchange failed');
      }

      const tokens = await response.json();
      qbTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        realmId: realmId as string
      };

      console.log(`[QUICKBOOKS] Successfully connected to Realm ${realmId}`);

      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #121212; color: white;">
            <div style="background: #181818; padding: 40px; border-radius: 24px; border: 1px solid #333; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
              <div style="color: #48bb78; font-size: 48px; margin-bottom: 20px;">✅</div>
              <h1 style="margin: 0 0 10px 0; font-size: 24px;">Connected!</h1>
              <p style="color: #a0aec0; margin-bottom: 20px;">QuickBooks is now linked to Smoke Eaters Pro.</p>
              <p style="font-size: 12px; color: #718096;">This window will close automatically...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'QB_AUTH_SUCCESS', realmId: '${realmId}' }, '*');
                  setTimeout(() => window.close(), 2000);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('[QUICKBOOKS ERROR]', err);
      res.status(500).send(`Error: ${(err as Error).message}`);
    }
  });

  // QuickBooks Status
  app.get("/api/quickbooks/status", (req, res) => {
    res.json({
      connected: !!qbTokens,
      realmId: qbTokens?.realmId || null
    });
  });

  // Quarterly Payroll Report Route
  app.get("/api/reports/payroll", async (req, res) => {
    const { year, quarter } = req.query;
    
    // In a real app, this would query QuickBooks API using qbTokens.access_token
    // If token expired, it would use qbTokens.refresh_token to get a new one
    
    console.log(`[REPORT] Generating Quarterly Payroll for Q${quarter} ${year}`);

    // Mock response for now
    setTimeout(() => {
      res.json({
        status: 'success',
        period: `Q${quarter} ${year}`,
        data: [
          { name: 'John Smith', role: 'Server', hours: 145.5, rate: 15.5, gross: 2255.25, tips: 840, tax: 450.5, net: 2644.75 },
          { name: 'Sarah Miller', role: 'Bartender', hours: 168, rate: 12, gross: 2016, tips: 1240, tax: 410.2, net: 2845.8 },
          { name: 'David Wilson', role: 'Kitchen', hours: 160, rate: 18, gross: 2880, tips: 0, tax: 576, net: 2304 },
          { name: 'Emma Davis', role: 'Manager', hours: 172, rate: 25, gross: 4300, tips: 0, tax: 860, net: 3440 }
        ],
        summary: {
          totalGross: 11451.25,
          totalTips: 2080,
          totalTax: 2296.7,
          totalNet: 11234.55
        }
      });
    }, 1500);
  });

  // AI custom report generator route using gemini-3.5-flash
  app.post("/api/reports/gemini-generate", async (req, res) => {
    try {
      const { userPrompt, inventory, stock, distributorMetadata, employees, invLogs } = req.body;
      if (!userPrompt) {
        return res.status(400).json({ error: "User prompt is required" });
      }

      console.log(`[AI REPORT] Generating custom report for prompt: "${userPrompt}"`);

      // Prep a simplified but complete text snapshot of the current environment
      const simplifiedInventory: Record<string, any[]> = {};
      if (inventory) {
        Object.keys(inventory).forEach(dist => {
          simplifiedInventory[dist] = (inventory[dist] || []).map((item: any) => ({
            name: item.n,
            minThreshold: item.m,
            parLevel: item.p || 0,
            unit: item.u || 'item',
            unitCost: item.c || 0,
            packageSize: item.sz || '',
            currentStock: stock && stock[item.n] !== undefined ? stock[item.n] : 0,
            oos: item.oos || false
          }));
        });
      }

      const simplifiedDistributors = distributorMetadata ? Object.entries(distributorMetadata).map(([name, meta]: [string, any]) => ({
        name,
        orderDay: meta.orderDay || '',
        frequency: meta.frequency || 'weekly',
        paymentTerms: meta.paymentTerms || '',
        deliverySchedule: meta.deliverySchedule || ''
      })) : [];

      const simplifiedEmployees = employees ? employees.map((emp: any) => ({
        name: emp.name,
        role: emp.role,
        status: emp.status || 'Active'
      })) : [];

      const systemPrompt = `You are 'Smoke Eaters Pro AI Report Generator', a specialized data analysis agent for a bar/restaurant operations dashboard.
You generate custom reports, bulk-import configs, schedules, counts, or visual reviews based on active dashboard datasets.

Below is the live operational data of our business:
---
INVENTORY & CURRENT STOCK (Grouped by Distributor):
${JSON.stringify(simplifiedInventory, null, 2)}

DISTRIBUTOR METADATA:
${JSON.stringify(simplifiedDistributors, null, 2)}

EMPLOYEE LIST:
${JSON.stringify(simplifiedEmployees, null, 2)}

RECENT STOCK ACTIONS:
${JSON.stringify((invLogs || []).slice(0, 30), null, 2)}
---

The user has requested the following custom report:
"${userPrompt}"

Analyze this query against the live dataset and compile a master report payload.
If the user's query asks for "all inventory details separated by distributor formatted for bulk upload" or similar, use the inventory list to construct rows of distributor items with columns: Distributor, Item Name, Min Threshold, Unit, Unit Cost, Par Level, Current Stock. Provide a fully qualified CSV box containing all this configuration.

Guidelines:
1. "title": Short, powerful, professional name.
2. "summary": Write a beautiful, deep, markdown-formatted operational analysis. Point out critical item warnings (such as OOS, below min, unbalanced cost-to-par distributions). Offer proactive purchasing strategies.
3. "table": Include a tabular grid showing rows of elements found/computed. For example, if compiling a distributor summary, cols could be [Distributor, Total Items, Below Min Counters, Total Value ($)]. Keep column headers neat and capitalized.
4. "chart": If there is numeric data to graph, specify the appropriate "type" ('bar' or 'pie' or 'none') and fill out "data" (mapping label names to numbers, e.g. [{"name": "Distributor A", "value": 150}]).
5. "csv": Generate a clean, copy-pasteable CSV string. Each line should have comma-separated values matching your table rows.

Return the response STRICTLY as a JSON object matching the requested schema. Do not output anything other than parseable JSON.`;

      const response = await genAI.models.generateContent({
        model: "gemini-3.5-flash",
        contents: systemPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              summary: { type: "STRING" },
              table: {
                type: "OBJECT",
                properties: {
                  headers: { type: "ARRAY", items: { type: "STRING" } },
                  rows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } } }
                },
                required: ["headers", "rows"]
              },
              chart: {
                type: "OBJECT",
                properties: {
                  type: { type: "STRING" },
                  data: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        name: { type: "STRING" },
                        value: { type: "NUMBER" }
                      },
                      required: ["name", "value"]
                    }
                  }
                },
                required: ["type", "data"]
              },
              csv: { type: "STRING" }
            },
            required: ["title", "summary", "table", "chart", "csv"]
          }
        }
      });

      const textResult = response.text || "{}";
      const parsedResult = JSON.parse(textResult);

      res.json({
        status: "success",
        timestamp: new Date().toISOString(),
        report: parsedResult
      });

    } catch (err: any) {
      console.error("[GEMINI REPORT GENERATION ERROR]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // SMTP Transporter Cache
  let cachedTransporter: any = null;
  let cachedCredentials = { user: '', pass: '', host: '', port: '' };

  const getTransporter = () => {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS?.replace(/\s/g, '');
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = process.env.SMTP_PORT || '587';

    if (!user || !pass) return null;

    if (
      cachedTransporter && 
      cachedCredentials.user === user && 
      cachedCredentials.pass === pass &&
      cachedCredentials.host === host &&
      cachedCredentials.port === port
    ) {
      return cachedTransporter;
    }

    console.log(`[MAIL] Initializing pooled mail transporter for ${user}`);
    cachedCredentials = { user, pass, host, port };
    cachedTransporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 1, // Keep it to 1 connection to avoid "too many logins" from multiple sources
      maxMessages: 100,
      rateLimit: 1, // 1 message per second max
      host,
      port: parseInt(port),
      secure: port === '465',
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      }
    });

    return cachedTransporter;
  };

  // SMTP Status endpoint
  app.get("/api/smtp-status", (req, res) => {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = process.env.SMTP_PORT || '587';
    
    res.json({
      configured: !!(user && pass),
      host,
      port,
      user: user ? `${user.split('@')[0]}@...` : null,
      hasPass: !!pass
    });
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: process.env.NODE_ENV
    });
  });

  app.get("/api/health/firestore-write-test", async (req, res) => {
    try {
      const db = getDb();
      if (!db) return res.status(500).json({ error: "Firestore not initialized" });
      
      const batch = db.batch();
      const testDoc = db.collection('system').doc('health_write_test');
      batch.set(testDoc, { 
        lastWrite: FieldValue.serverTimestamp(),
        msg: "Firestore write test from server" 
      }, { merge: true });
      
      await batch.commit();
      
      const snapshot = await testDoc.get();
      res.json({ 
        status: "success", 
        data: snapshot.data(),
        project: process.env.GOOGLE_CLOUD_PROJECT || 'unknown'
      });
    } catch (err: any) {
      console.error("[FIRESTORE WRITE TEST ERROR]", err);
      res.status(500).json({ 
        error: err.message, 
        code: err.code,
        details: err.details,
        stack: err.stack
      });
    }
  });

  app.get("/api/health/firestore", async (req, res) => {
    try {
      const db = getDb();
      if (!db) return res.status(500).json({ error: "Firestore not initialized" });
      
      // Attempt a write or at least a read to check permissions
      const testDoc = db.collection('system').doc('health');
      await testDoc.set({ 
        lastCheck: FieldValue.serverTimestamp(),
        msg: "Firestore health check from server" 
      }, { merge: true });
      
      const snapshot = await testDoc.get();
      res.json({ 
        status: "success", 
        data: snapshot.data(),
        project: process.env.GOOGLE_CLOUD_PROJECT || 'unknown'
      });
    } catch (err: any) {
      console.error("[FIRESTORE HEALTH ERROR]", err);
      res.status(500).json({ 
        error: err.message, 
        code: err.code,
        details: err.details 
      });
    }
  });

  // Log all API requests with more detail
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[API] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
      });
    }
    next();
  });

  // API Route for alerts
  app.post("/api/send-alert", async (req, res) => {
    const { item, type, level, email, onHand, min, items, immediate } = req.body;
    
    // USER REQUEST: Turn off critical stock alerts / critical email alerts
    if (process.env.ALERTS_DISABLED === 'true' || true) { // Force true as per user request
      console.log("[ALERT] Alerts are currently DISABLED by user request.");
      return res.json({ status: "success", message: "Alerts are currently disabled." });
    }

    const targetEmail = email || process.env.ALERT_RECIPIENT_EMAIL || 'rhart13fox@gmail.com';
    
    // Check if it's a batch request
    const itemsToProcess = items && Array.isArray(items) ? items : (item ? [{ item, type, level, onHand, min }] : []);
    
    if (itemsToProcess.length === 0) {
      return res.status(400).json({ status: "error", message: "No items provided" });
    }

    // Determine if this should be immediate (Tests or explicitly requested)
    const isTest = item === 'TEST ALERT' || (itemsToProcess.length === 1 && itemsToProcess[0].item === 'TEST ALERT');
    const shouldBeImmediate = immediate || isTest;

    if (shouldBeImmediate) {
      console.log(`[ALERT] Sending IMMEDIATE alert for ${isTest ? 'TEST' : itemsToProcess[0].item} to ${targetEmail}`);
      try {
        const transporter = getTransporter();
        if (transporter) {
          if (itemsToProcess.length > 1 || isTest) {
            const itemRows = itemsToProcess.map((i: any) => `
              <tr>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${i.item}</td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${i.type === 'manual' ? 'Manual Flag' : 'Below Min'}</td>
                <td style="padding: 10px; border: 1px solid #dee2e6;"><b>${i.level || i.onHand || 'N/A'}</b></td>
              </tr>
            `).join('');

            await transporter.sendMail({
              from: `"Smoke Eaters Operations" <${process.env.SMTP_USER}>`,
              to: targetEmail,
              subject: isTest ? "🧪 SMTP Test Connection" : `⚠️ Critical Stock Alerts (${itemsToProcess.length} items)`,
              html: `<div style="font-family: sans-serif;">
                <h2 style="color: #e63946;">${isTest ? 'Test Alert' : 'Multiple Low Stock Alerts'}</h2>
                <p>${isTest ? 'This is a successful test of your SMTP configuration.' : 'The following items need attention:'}</p>
                <table style="width: 100%; border-collapse: collapse;">
                  <thead>
                    <tr style="background: #f8f9fa;">
                      <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Item</th>
                      <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Reason</th>
                      <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Level</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}</tbody>
                </table>
              </div>`
            });
          } else {
            const i = itemsToProcess[0];
            await transporter.sendMail({
              from: `"Smoke Eaters Operations" <${process.env.SMTP_USER}>`,
              to: targetEmail,
              subject: `⚠️ Low Stock Alert: ${i.item}`,
              text: `Item "${i.item}" is currently low.\n\nType: ${i.type}\nLevel: ${i.level || i.onHand}\nOn Hand: ${i.onHand || 'N/A'}\nMinimum required: ${i.min || 'N/A'}\n\nPlease update inventory as soon as possible.`,
              html: `<div style="font-family: sans-serif;">
                <h2 style="color: #e63946;">Low Stock Alert</h2>
                <p>The following item is below its minimum threshold:</p>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr style="background: #f8f9fa;">
                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Item</th>
                    <td style="padding: 10px; border: 1px solid #dee2e6;">${i.item}</td>
                  </tr>
                  <tr>
                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Reason</th>
                    <td style="padding: 10px; border: 1px solid #dee2e6;">${i.type === 'manual' ? 'Manual Flag' : 'Below Minimum Threshold'}</td>
                  </tr>
                  <tr style="background: #f8f9fa;">
                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Current Level</th>
                    <td style="padding: 10px; border: 1px solid #dee2e6;"><b>${i.onHand || i.level || 'N/A'}</b></td>
                  </tr>
                </table>
              </div>`
            });
          }
          return res.json({ status: "success", message: "Immediate alert sent" });
        } else {
          return res.status(400).json({ status: "error", message: "SMTP not configured" });
        }
      } catch (error) {
        return res.status(500).json({ status: "error", message: (error as Error).message });
      }
    } else {
      // Queue for 6 AM summary
      console.log(`[ALERT] Queuing ${itemsToProcess.length} alert(s) for 6 AM summary`);
      try {
        const db = getDb();
        if (!db) {
          throw new Error("Firestore not initialized");
        }
        
        // Log the active database path for debugging
        const activeProject = (db as any).projectId || 'unknown';
        const activeDb = (db as any).databaseId || '(default)';
        console.log(`[ALERT] Using database: projects/${activeProject}/databases/${activeDb}`);

        const batch = db.batch();
        itemsToProcess.forEach(a => {
          const docRef = db.collection('pending_alerts').doc();
          batch.set(docRef, {
            ...a,
            targetEmail,
            createdAt: FieldValue.serverTimestamp()
          });
        });
        
        console.log(`[ALERT] Committing batch for ${itemsToProcess.length} items to database...`);
        try {
          await batch.commit();
          return res.json({ status: "success", message: "Queued for 6 AM summary" });
        } catch (commitError: any) {
          console.error("[BATCH COMMIT ERROR] Details:", {
            message: commitError.message,
            code: commitError.code,
            details: commitError.details,
            metadata: commitError.metadata,
            stack: commitError.stack
          });
          
        if (commitError.code === 7 || commitError.code === 5 || commitError.message?.includes('PERMISSION_DENIED') || commitError.message?.includes('NOT_FOUND')) {
            console.error(`[FIREBASE] ${commitError.code === 5 ? 'Database NOT_FOUND' : 'Permission denied'} on batch commit.`);
            
            // EMERGENCY FALLBACK: If we haven't already, switch to default database for future calls
            if (_db && _db.databaseId && _db.databaseId !== "(default)") {
              console.log("[FIREBASE] Dynamic fallback to (default) database triggered by failed batch commit.");
              try {
                const fallbackDb = getFirestore(getApps()[0]);
                _db = fallbackDb;
                
                // RETRY: Try to commit once more to the default database
                console.log("[FIREBASE] Retrying batch commit on (default) database...");
                const retryBatch = fallbackDb.batch();
                itemsToProcess.forEach(a => {
                  const docRef = fallbackDb.collection('pending_alerts').doc();
                  retryBatch.set(docRef, { ...a, targetEmail, createdAt: FieldValue.serverTimestamp() });
                });
                await retryBatch.commit();
                return res.json({ status: "success", message: "Queued for 6 AM summary (via emergency fallback)" });
              } catch (retryErr: any) {
                console.error("[FIREBASE] Retry also failed:", retryErr.message);
              }
            }
          }

          // FALLBACK: If we can't queue, try to send immediately if SMTP is configured
          const transporter = getTransporter();
          if (transporter) {
            console.log("[ALERT FALLBACK] Database failed, sending direct email immediate fallback...");
            try {
              const itemRows = itemsToProcess.map((i: any) => `
                <tr>
                  <td style="padding: 10px; border: 1px solid #dee2e6;">${i.item}</td>
                  <td style="padding: 10px; border: 1px solid #dee2e6;">${i.type === 'manual' ? 'Manual Flag' : 'Below Min'}</td>
                  <td style="padding: 10px; border: 1px solid #dee2e6;"><b>${i.level || i.onHand || 'N/A'}</b></td>
                </tr>
              `).join('');

              await transporter.sendMail({
                from: `"Smoke Eaters Operations" <${process.env.SMTP_USER}>`,
                to: targetEmail,
                subject: `⚠️ Critical Stock Alerts (Immediate Fallback)`,
                html: `<div style="font-family: sans-serif;">
                  <h2 style="color: #e63946;">Stock Alerts (Database Queue Failed)</h2>
                  <p>We were unable to queue these for the 6 AM summary, so they are being sent immediately.</p>
                  <p style="font-size: 11px; color: #777;">Reason: ${commitError.message}</p>
                  <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                      <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Item</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Reason</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Level</th>
                      </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                  </table>
                </div>`
              });
              return res.json({ status: "success", message: "Database failed; alert sent directly via email instead." });
            } catch (mailError) {
              console.error("[FALLBACK MAIL ERROR]", mailError);
            }
          }

          // Distinguish between real permission issues and quota exhaustion
          if (commitError.code === 8 || commitError.message?.includes('resource-exhausted') || commitError.message?.includes('Quota exceeded')) {
             return res.status(429).json({ 
               status: "error", 
               message: "Firestore Quota Exceeded. Daily write limits have been reached." 
             });
          }
          if (commitError.code === 7 || commitError.message?.includes('PERMISSION_DENIED')) {
             return res.status(403).json({ 
               status: "error", 
               message: `Database permission denied. Alerts could not be queued. Detail: ${commitError.message}` 
             });
          }
          throw commitError;
        }
      } catch (err) {
        const error = err as any;
        console.error("[QUEUE ERROR]", error);
        
        // If it's a quota error, return a specific message
        if (error.message?.includes('quota') || error.message?.includes('resource-exhausted') || error.code === 8) {
          return res.status(429).json({ 
            status: "error", 
            message: "Cloud storage quota exceeded. Summary alerts are paused until limits reset." 
          });
        }

        return res.status(500).json({ status: "error", message: "Failed to queue alert: " + error.message });
      }
    }
  });

  // Function to process and send pending alerts at 6 AM
  const processPendingAlerts = async () => {
    // USER REQUEST: Turn off alerts
    if (process.env.ALERTS_DISABLED === 'true' || true) {
      console.log("[CRON] Skipping summary - Alerts are currently DISABLED by user request.");
      return;
    }
    console.log("[CRON] Checking for pending alerts and inventory reminders...");
    try {
      const db = getDb();
      const mainEmail = process.env.ALERT_RECIPIENT_EMAIL || 'rhart13fox@gmail.com';
      
      if (!db) {
        console.warn("[CRON] Skipping summary - Firestore not available");
        return;
      }

      // 1. Process Low Stock Alerts
      const snapshot = await db.collection('pending_alerts').get();
      
      // 2. Check for Inventory Reminders (Day before order day)
      const stateDoc = await db.collection('system').doc('state').get();
      let inventoryReminders: string[] = [];
      if (stateDoc.exists) {
        const metadata = stateDoc.data()?.distributorMetadata || {};
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const tomorrowIndex = (new Date().getDay() + 1) % 7;
        const tomorrowName = days[tomorrowIndex];

        Object.entries(metadata).forEach(([dist, meta]: [string, any]) => {
          if (meta.orderDay === tomorrowName) {
            inventoryReminders.push(dist);
          }
        });
      }

      if (snapshot.empty && inventoryReminders.length === 0) {
        console.log("[CRON] No pending alerts or inventory reminders found.");
        return;
      }

      // Group alerts by target email
      const alertsByEmail: Record<string, any[]> = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        const email = data.targetEmail || mainEmail;
        if (!alertsByEmail[email]) alertsByEmail[email] = [];
        alertsByEmail[email].push({ id: doc.id, ...data });
      });

      const transporter = getTransporter();
      if (!transporter) {
        console.error("[CRON ERROR] SMTP not configured for batch send.");
        return;
      }

      // Ensure main user gets the update even if no low stock alerts (for reminders)
      if (!alertsByEmail[mainEmail] && inventoryReminders.length > 0) {
        alertsByEmail[mainEmail] = [];
      }

      for (const [email, alerts] of Object.entries(alertsByEmail)) {
        console.log(`[CRON] Sending summary to ${email}`);
        
        // Deduplicate stock items
        const uniqueAlertsMap = new Map();
        alerts.forEach(a => {
          uniqueAlertsMap.set(a.item, a);
        });
        const uniqueAlerts = Array.from(uniqueAlertsMap.values());

        const reminderHtml = inventoryReminders.length > 0 && email === mainEmail ? `
          <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 25px; border-radius: 8px;">
            <h3 style="margin: 0; color: #856404; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">📋 Inventory Check Reminder</h3>
            <p style="margin: 5px 0 0 0; font-size: 13px;">Tomorrow is <b>Order Day</b> for the following distributors. <u>Please inventory these today</u>:</p>
            <ul style="margin: 10px 0 0 0; padding-left: 20px; font-weight: bold; color: #1a1a1a;">
              ${inventoryReminders.map(d => `<li>${d}</li>`).join('')}
            </ul>
          </div>
        ` : '';

        const itemRows = uniqueAlerts.map((i: any) => `
          <tr>
            <td style="padding: 10px; border: 1px solid #dee2e6;">${i.item}</td>
            <td style="padding: 10px; border: 1px solid #dee2e6;">${i.type === 'manual' ? 'Manual Flag' : 'Below Min'}</td>
            <td style="padding: 10px; border: 1px solid #dee2e6;"><b>${i.level || i.onHand || 'N/A'}</b></td>
          </tr>
        `).join('');

        const stockHtml = uniqueAlerts.length > 0 ? `
          <h3 style="color: #e63946; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">⚠️ Low Stock Items</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
            <thead>
              <tr style="background: #f8f9fa;">
                <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left; font-size: 11px;">Item</th>
                <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left; font-size: 11px;">Reason</th>
                <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left; font-size: 11px;">Level</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        ` : (inventoryReminders.length > 0 ? '<p style="font-size: 13px; color: #666;">No new low stock alerts to report.</p>' : '');

        await transporter.sendMail({
          from: `"Smoke Eaters Operations" <${process.env.SMTP_USER}>`,
          to: email,
          subject: inventoryReminders.length > 0 ? `📋 Operations Alert: Inventory Reminder & Stock Recap` : `⚠️ Daily Stock Recap (${uniqueAlerts.length} items)`,
          html: `<div style="font-family: sans-serif; max-width: 600px; color: #333;">
            <h2 style="color: #1a1a1a; margin-bottom: 20px;">Daily Status Update</h2>
            ${reminderHtml}
            ${stockHtml}
            <p style="margin-top: 30px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 10px;">
              This is an automated 6:00 AM summary from Smoke Eaters Pro.
            </p>
          </div>`
        });

        // Delete processed alerts
        const db = getDb();
        if (db && alerts.length > 0) {
          const deleteBatch = db.batch();
          alerts.forEach(a => {
            if (a.id) deleteBatch.delete(db.collection('pending_alerts').doc(a.id));
          });
          await deleteBatch.commit();
        }
      }
      console.log("[CRON] Daily alert summary complete.");
    } catch (err) {
      console.error("[CRON ERROR]", err);
    }
  };

  // Schedule for 6 AM daily
  cron.schedule('0 6 * * *', processPendingAlerts);

  // API Route for shift notifications (approvals and reminders)
  app.post("/api/send-shift-notification", async (req, res) => {
    const { email, employeeName, shiftTitle, shiftStart, type } = req.body;

    // USER REQUEST: Turn off alerts
    if (process.env.ALERTS_DISABLED === 'true' || true) {
      console.log("[SHIFT NOTIFICATION] Skipping - Alerts are currently DISABLED by user request.");
      return res.json({ status: "success", message: "Alerts are currently disabled." });
    }

    const targetEmail = email || process.env.ALERT_RECIPIENT_EMAIL || 'rhart13fox@gmail.com';
    
    const startTime = new Date(shiftStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const startDate = new Date(shiftStart).toLocaleDateString();

    console.log(`[SHIFT NOTIFICATION] Sending ${type} for ${shiftTitle} to ${targetEmail}`);

    try {
      const transporter = getTransporter();

      if (transporter) {
        let subject = "";
        let html = "";
        let text = "";

        if (type === 'approval') {
          subject = `✅ Shift Approved: ${shiftTitle}`;
          text = `Hi ${employeeName},\n\nYour shift "${shiftTitle}" on ${startDate} at ${startTime} has been approved.\n\nSee you then!`;
          html = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px;">
            <h2 style="color: #2f855a; border-bottom: 2px solid #2f855a; padding-bottom: 10px;">Shift Approved</h2>
            <p>Hi <b>${employeeName}</b>,</p>
            <p>Your request for the following shift has been <b>approved</b>:</p>
            <div style="background: #f0fff4; border-left: 4px solid #48bb78; padding: 15px; margin: 20px 0;">
              <h3 style="margin: 0 0 5px 0;">${shiftTitle}</h3>
              <p style="margin: 0; font-size: 14px; color: #2f855a;">${startDate} @ ${startTime}</p>
            </div>
            <p style="font-size: 12px; color: #718096;">This is an automated message from Smoke Eaters Pro.</p>
          </div>`;
        } else if (type === 'reminder') {
          subject = `⏰ Shift Reminder: ${shiftTitle} starts in 1 hour`;
          text = `Hi ${employeeName},\n\nJust a reminder that your shift "${shiftTitle}" starts within an hour (at ${startTime}).\n\nDon't be late!`;
          html = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px;">
            <h2 style="color: #2b6cb0; border-bottom: 2px solid #2b6cb0; padding-bottom: 10px;">Shift Reminder</h2>
            <p>Hi <b>${employeeName}</b>,</p>
            <p>This is a reminder that your shift starts in <b>less than one hour</b>:</p>
            <div style="background: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px; margin: 20px 0;">
              <h3 style="margin: 0 0 5px 0;">${shiftTitle}</h3>
              <p style="margin: 0; font-size: 14px; color: #2b6cb0;">Starts at: <b>${startTime}</b> today</p>
            </div>
            <p>We'll see you soon!</p>
            <p style="font-size: 12px; color: #718096;">This is an automated message from Smoke Eaters Pro.</p>
          </div>`;
        }

        await transporter.sendMail({
          from: `"Smoke Eaters Operations" <${process.env.SMTP_USER}>`,
          to: targetEmail,
          subject,
          text,
          html
        });

        return res.json({ 
          status: "success", 
          message: `Shift ${type} email sent to ${employeeName}`
        });
      } else {
        return res.status(400).json({ 
          status: "error", 
          message: "SMTP credentials not configured." 
        });
      }
    } catch (error) {
      const err = error as any;
      console.error(`[MAIL ERROR] Shift Notification: ${err.message}`);
      return res.status(500).json({ 
        status: "error", 
        message: `Failed to send shift notification: ${err.message}` 
      });
    }
  });

  // API Route for full inventory report
  app.post("/api/send-inventory-report", async (req, res) => {
    const { distributor, items, employee, email } = req.body;

    // USER REQUEST: Turn off alerts
    if (process.env.ALERTS_DISABLED === 'true' || true) {
      console.log("[INVENTORY REPORT] Skipping - Alerts are currently DISABLED by user request.");
      return res.json({ status: "success", message: "Alerts are currently disabled." });
    }

    const targetEmail = email || process.env.ALERT_RECIPIENT_EMAIL || 'rhart13fox@gmail.com';

    console.log(`[INVENTORY REPORT] Processing report for ${distributor} to ${targetEmail}`);

    try {
      const transporter = getTransporter();

      if (transporter) {
        const itemListRows = items.map((item: any) => `
          <tr style="${(parseFloat(item.onHand) <= parseFloat(item.min)) ? 'background-color: #fff5f5;' : ''}">
            <td style="padding: 8px; border: 1px solid #eee;">${item.name}</td>
            <td style="padding: 8px; border: 1px solid #eee; text-align: center; color: ${parseFloat(item.onHand) <= parseFloat(item.min) ? '#e53e3e' : '#2d3748'}">
              <b>${item.onHand}</b>
            </td>
            <td style="padding: 8px; border: 1px solid #eee; text-align: center;">${item.min}</td>
            <td style="padding: 8px; border: 1px solid #eee;">${item.unit}</td>
            <td style="padding: 8px; border: 1px solid #eee; text-align: center;">${item.flagged ? '⚠️' : ''}</td>
          </tr>
        `).join('');

        await transporter.sendMail({
          from: `"Smoke Eaters Operations" <${process.env.SMTP_USER}>`,
          to: targetEmail,
          subject: `📦 Inventory Completed: ${distributor}`,
          html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
            <h2 style="color: #2b6cb0; border-bottom: 2px solid #2b6cb0; padding-bottom: 10px;">${distributor} Inventory Report</h2>
            <p style="color: #4a5568;">Created by: <b>${employee}</b> on ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
            
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
              <thead>
                <tr style="background: #edf2f7;">
                  <th style="padding: 8px; border: 1px solid #e2e8f0; text-align: left;">Item</th>
                  <th style="padding: 8px; border: 1px solid #e2e8f0;">On Hand</th>
                  <th style="padding: 8px; border: 1px solid #e2e8f0;">Min</th>
                  <th style="padding: 8px; border: 1px solid #e2e8f0; text-align: left;">Unit</th>
                  <th style="padding: 8px; border: 1px solid #e2e8f0;">!</th>
                </tr>
              </thead>
              <tbody>
                ${itemListRows}
              </tbody>
            </table>

            <p style="margin-top: 20px; font-size: 11px; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 10px;">
              This is an automated report from Smoke Eaters Pro. Low stock items are highlighted in red.
            </p>
          </div>`
        });

        return res.json({ 
          status: "success", 
          message: `Inventory report email sent for ${distributor}`
        });
      } else {
        console.warn("[MAIL] Skipping inventory report send - SMTP_USER or SMTP_PASS missing in environment.");
        return res.status(400).json({ 
          status: "error", 
          message: "SMTP credentials not configured." 
        });
      }
    } catch (error) {
      const err = error as any;
      console.error(`[MAIL ERROR] Report: ${err.message}`);
      
      let hint = "";
      if (err.message?.includes('535') || err.message?.includes('Invalid login')) {
        hint = " (Auth Failed)";
      } else if (err.message?.includes('454')) {
        hint = " (Rate Limit Exceeded)";
      }
      return res.status(500).json({ 
        status: "error", 
        message: `Failed to send report: ${err.message}${hint}` 
      });
    }
  });

  // --- Automated Distributor Portal Scraper ---
  app.post("/api/distributor/auto-sync", async (req, res) => {
    const { url, username, password, distributorName } = req.body;
    if (!url) return res.status(400).json({ error: "Portal URL is required" });

    let browser;
    try {
      console.log(`[SCRAPER] Starting puppeteer for ${distributorName}`);
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      // Set a realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

      console.log(`[SCRAPER] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

      // Best effort Login
      if (username && password) {
        console.log(`[SCRAPER] Attempting login for ${distributorName}`);
        try {
          // Look for common login selectors
          const loginInputs = await page.$$('input[type="text"], input[type="email"], input[name*="user" i], input[name*="login" i], input[id*="user" i], input[id*="login" i]');
          const passwordInputs = await page.$$('input[type="password"]');

          if (loginInputs.length > 0 && passwordInputs.length > 0) {
            await loginInputs[0].type(username);
            await passwordInputs[0].type(password);
            
            // Look for submit button
            const submitButtons = await page.$$('button[type="submit"], input[type="submit"], button:not([type]), .login-btn, #login-btn, [name*="login" i]');
            if (submitButtons.length > 0) {
              await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
                submitButtons[0].click()
              ]);
            }
          }
        } catch (loginError) {
          console.warn("[SCRAPER] Login likely failed or timed out, proceeding as-is", loginError);
        }
      }

      // Try to find helpful pages
      const pageData: string[] = [];
      
      // Capture current page text
      const initialText = await page.evaluate(() => document.body.innerText);
      pageData.push(initialText);

      // Simple heuristic: look for links that might contain pricing
      const likelyLinks = await page.$$eval('a', anchors => 
        anchors
          .filter(a => {
            const text = a.innerText.toLowerCase();
            return text.includes('order') || text.includes('guide') || text.includes('history') || 
                   text.includes('pricing') || text.includes('catalog') || text.includes('inventory');
          })
          .map(a => a.href)
          .slice(0, 2)
      );

      for (const link of likelyLinks) {
        try {
          console.log(`[SCRAPER] Clicking likely relevant link: ${link}`);
          // Open in same tab
          await page.goto(link, { waitUntil: 'networkidle2', timeout: 15000 });
          const text = await page.evaluate(() => document.body.innerText);
          pageData.push(`--- PAGE: ${link} ---\n${text}`);
        } catch (e) {
          console.warn(`[SCRAPER] Failed to crawl link: ${link}`);
        }
      }

      await browser.close();
      res.json({ 
        status: 'success', 
        data: pageData.join('\n\n'),
        distributor: distributorName
      });
    } catch (error) {
      if (browser) await browser.close();
      console.error("[SCRAPER] Fatal error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POS Integration Endpoints - DISABLED BY REQUEST
  app.post("/api/pos/test-connection", (req, res) => {
    res.status(503).json({ status: 'error', message: 'POS Sync is currently disabled to optimize system performance.' });
  });

  app.post("/api/pos/sync-sales", (req, res) => {
    res.status(503).json({ status: 'error', message: 'POS Sync is currently disabled to optimize system performance.' });
  });

  app.post("/api/pos/sync-inventory", (req, res) => {
    res.status(503).json({ status: 'error', message: 'POS Sync is currently disabled to optimize system performance.' });
  });

  // --- QR Code Generator & Management Endpoints ---
  app.post("/api/qr/generate", async (req, res) => {
    const { type, identifier, secondaryId, label, contentUrl } = req.body;
    if (!type || !identifier) {
      return res.status(400).json({ error: "Type and identifier are required" });
    }

    try {
      // Create QR Code data payload
      let payload = contentUrl;
      if (!payload) {
        if (type === "table") {
          // Point back to the origin's patron mode for this table
          const originHost = req.get('origin') || `${req.protocol}://${req.get('host')}`;
          payload = `${originHost}?patron=true&table=${encodeURIComponent(identifier)}${secondaryId ? `&seat=${encodeURIComponent(secondaryId)}` : ''}`;
        } else {
          // Machine or other identifiers
          const originHost = req.get('origin') || `${req.protocol}://${req.get('host')}`;
          payload = `${originHost}?mode=patron&machine=${encodeURIComponent(identifier)}${secondaryId ? `&sub=${encodeURIComponent(secondaryId)}` : ''}`;
        }
      }

      console.log(`[QR GENERATOR] Generating QR for Type: ${type}, Payload: ${payload}`);

      // Generate base64 data URL png
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 300,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });

      res.json({
        success: true,
        type,
        identifier,
        secondaryId,
        label: label || `${type === 'table' ? 'Table' : 'Machine'} ${identifier}`,
        payload,
        qrDataUrl: dataUrl
      });
    } catch (err: any) {
      console.error("[QR GENERATOR ERROR]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Save generated QR code
  app.post("/api/qr/save", async (req, res) => {
    const { type, identifier, secondaryId, label, payload, qrDataUrl } = req.body;
    if (!type || !identifier || !qrDataUrl) {
      return res.status(400).json({ error: "Missing required fields to save QR" });
    }

    const newQr = {
      id: "qr-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      type,
      identifier,
      secondaryId: secondaryId || "",
      label: label || `${type === 'table' ? 'Table' : 'Machine'} ${identifier}`,
      payload,
      qrDataUrl,
      createdAt: new Date().toISOString()
    };

    let savedToFirestore = false;
    let savedToDisk = false;

    // 1. Attempt Firestore save
    try {
      const db = getDb();
      if (db) {
        await db.collection('qr_codes').doc(newQr.id).set(newQr);
        savedToFirestore = true;
        console.log(`[QR GENERATOR] Saved QR ${newQr.id} to Firestore`);
      }
    } catch (fsErr: any) {
      console.warn("[QR GENERATOR] Failed saving to Firestore, using disk fallback:", fsErr.message);
    }

    // 2. Always write to local disk JSON fallback to be safe and persistent
    try {
      const localPath = path.join(process.cwd(), "saved_qrcodes.json");
      let diskQrs: any[] = [];
      if (fs.existsSync(localPath)) {
        try {
          diskQrs = JSON.parse(fs.readFileSync(localPath, "utf-8"));
        } catch (e) {
          console.error("[QR GENERATOR] Error parsing saved_qrcodes.json, resetting");
        }
      }
      diskQrs.push(newQr);
      fs.writeFileSync(localPath, JSON.stringify(diskQrs, null, 2));
      savedToDisk = true;
      console.log(`[QR GENERATOR] Saved QR ${newQr.id} to saved_qrcodes.json`);
    } catch (diskErr: any) {
      console.error("[QR GENERATOR] Failed saving to disk:", diskErr.message);
    }

    res.json({
      success: true,
      qr: newQr,
      savedToFirestore,
      savedToDisk
    });
  });

  // Retrieve saved QR codes
  app.get("/api/qr/saved", async (req, res) => {
    let qrs: any[] = [];
    let source = "disk";

    // 1. Try Firestore first
    try {
      const db = getDb();
      if (db) {
        const snapshot = await db.collection('qr_codes').get();
        if (!snapshot.empty) {
          snapshot.forEach(doc => {
            qrs.push(doc.data());
          });
          // Sort by creation date or id
          qrs.sort((a: any, b: any) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
          source = "firestore";
          console.log(`[QR GENERATOR] Retrieved ${qrs.length} QR codes from Firestore`);
        }
      }
    } catch (fsErr: any) {
      console.warn("[QR GENERATOR] Firestore retrieve failed, using local disk:", fsErr.message);
    }

    // 2. If firestore empty or failed, load from local disk
    if (qrs.length === 0) {
      try {
        const localPath = path.join(process.cwd(), "saved_qrcodes.json");
        if (fs.existsSync(localPath)) {
          qrs = JSON.parse(fs.readFileSync(localPath, "utf-8"));
          qrs.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
          source = "disk";
          console.log(`[QR GENERATOR] Retrieved ${qrs.length} QR codes from saved_qrcodes.json`);
        }
      } catch (diskErr: any) {
        console.error("[QR GENERATOR] Local retrieve failed:", diskErr.message);
      }
    }

    res.json({
      success: true,
      source,
      qrs
    });
  });

  // Delete saved QR code
  app.delete("/api/qr/delete/:id", async (req, res) => {
    const { id } = req.params;
    let deletedFromFirestore = false;
    let deletedFromDisk = false;

    // 1. Delete from Firestore
    try {
      const db = getDb();
      if (db) {
        await db.collection('qr_codes').doc(id).delete();
        deletedFromFirestore = true;
        console.log(`[QR GENERATOR] Deleted QR ${id} from Firestore`);
      }
    } catch (fsErr: any) {
      console.warn("[QR GENERATOR] Firestore delete failed:", fsErr.message);
    }

    // 2. Delete from local disk fallback
    try {
      const localPath = path.join(process.cwd(), "saved_qrcodes.json");
      if (fs.existsSync(localPath)) {
        let diskQrs = JSON.parse(fs.readFileSync(localPath, "utf-8"));
        const originalLength = diskQrs.length;
        diskQrs = diskQrs.filter((qr: any) => qr.id !== id);
        if (diskQrs.length !== originalLength) {
          fs.writeFileSync(localPath, JSON.stringify(diskQrs, null, 2));
          deletedFromDisk = true;
          console.log(`[QR GENERATOR] Deleted QR ${id} from saved_qrcodes.json`);
        }
      }
    } catch (diskErr: any) {
      console.error("[QR GENERATOR] Local delete failed:", diskErr.message);
    }

    res.json({
      success: true,
      deletedFromFirestore,
      deletedFromDisk
    });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("[SERVER FATAL ERROR]", err);
    if (!res.headersSent) {
      res.status(500).json({ 
        status: 'error', 
        error: 'Internal Server Error',
        message: err.message
      });
    }
  });

  // Vite integration and static serving moved to end of API routes section

  // API Route for scanning POS Sales Reports - DISABLED BY REQUEST
  app.post("/api/scan/pos-report", async (req, res) => {
    res.status(503).json({ status: 'error', message: 'POS Report Scanning is currently disabled to optimize system performance.' });
  });

  // API Route for Vision-based Inventory Matching
  app.post("/api/inventory/vision-match", async (req, res) => {
    const { image, inventoryItems } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    try {
      console.log(`[VISION] Analyzing inventory photo...`);
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                text: `You are an inventory audit assistant for a bar/restaurant. Analyze this photo of physical inventory (bottles, cans, cases).
                
                Identify the items present in the photo. 
                I have an existing inventory list for reference: 
                ${inventoryItems && Array.isArray(inventoryItems) ? inventoryItems.join(', ') : 'No reference list provided.'}

                For each identified item, provide:
                - Name (Strictly match it to my existing inventory list if it corresponds to an item there. If not in my list, use the label on the product).
                - Quantity visible in the photo (Count individual units or cases).
                - Confidence level (0 to 1).
                - matched (boolean: true if you matched it to an item in my reference list).

                Return the results as a JSON object with an "items" array.
                If you see items not in my list, include them as well.
                JSON structure: { "items": [ { "name": string, "quantity": number, "confidence": number, "matched": boolean } ] }`
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: image.split(',')[1] // Assuming base64 data URI
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const extracted = JSON.parse(response.text);
      res.json(extracted);
    } catch (error) {
      console.error("[VISION ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/barcode/lookup", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Barcode is required" });

    try {
      console.log(`[BARCODE] Looking up item for code: ${code}`);
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                text: `You are a product database. Identify the consumer product associated with the barcode/UPC code: ${code}.
                
                The product is likely a beverage (liquor, beer, soda), food item, or cleaning supply for a bar/restaurant.
                
                Return a JSON object with:
                - name (string: brand and product name, e.g. "Jack Daniels Old No. 7")
                - size (string: e.g. "1L", "750ml", "12oz")
                - category (string: e.g. "Liquor", "Beer", "Supply")
                - description (string: brief description)
                - manufacturer (string: brand owner)
                
                If you aren't absolutely sure, provide your best guess based on the code format or standard prefixes.
                JSON structure: { "name": string, "size": string, "category": string, "description": string, "manufacturer": string }`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const data = JSON.parse(response.text);
      res.json(data);
    } catch (error) {
      console.error("[BARCODE LOOKUP ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API Route for terminal receipt scanning (Gaming/Tills)
  app.post("/api/scan/terminal-receipt", async (req, res) => {
    const { image, tab, hint } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    try {
      console.log(`[SCANNER] Scanning terminal receipt for ${tab} ${hint ? `(Hint: ${hint})` : ''}`);
      
      let prompt = "";
      let responseSchema: any = {};

      if (tab === 'gaming') {
        prompt = `Extract specific gaming values from this terminal receipt image. 
${hint ? `NOTE: The user believes this receipt is for the "${hint}" machine.` : ''}
We are looking for:
1. "Closing Balance" (Synonyms: Actual Balance, Cash In Machine, CL BAL, Terminal Total, Cash Content, Cash in Box).
2. "Redemptions" (Synonyms: Tickets Redeemed, Tickets, Voucher Out, Payouts, Withdrawals, Cash Paid, Total Tickets, Vouchers).
3. Machine identifier: look for names like "GROVER", "G", "CTG", "C", "Terminal ID", or machine serial numbers (e.g., G-XXXX or C-XXXX).
4. "Deposit" or "Deduction" (Money deducted from the payout).

Return the values as a JSON object. 
- Identify the machine as "machine": one of ["GROVER", "CTG"]. If unable to distinguish clearly ${hint ? `and no conflicting evidence exists, default to "${hint}"` : 'use "UNKNOWN"'}.
- Sum all redemption/payout/withdrawal/ticket values into a single "tickets" field.
- If a value is missing or not found, return it as 0.`;
        responseSchema = {
          type: "object",
          properties: {
            closingBalance: { type: "number" },
            tickets: { type: "number" },
            deposit: { type: "number" },
            machine: { type: "string", enum: ["GROVER", "CTG", "UNKNOWN"] }
          },
          required: ["closingBalance", "tickets", "machine", "deposit"]
        };
      } else if (tab === 'tills') {
        prompt = `Extract till closing values from this terminal receipt image. 
We are looking for:
1. "Cash Short" (Synonyms: Shortage, Actual Cash Short, Variance, Over/Short, Cash Over/Short, Cash +/-).
2. "Deposit" (Synonyms: Net Deposit, Bank Deposit, Cash to Bank, Daily Deposit, Drop Amount).

Return the values as a JSON object. If a value is missing or not found, return it as 0. Ensure "cashShort" is returned as a positive number regardless of how it appears on the receipt.`;
        responseSchema = {
          type: "object",
          properties: {
            cashShort: { type: "number" },
            deposit: { type: "number" }
          },
          required: ["cashShort", "deposit"]
        };
      } else {
        prompt = "Extract the final total amount from this receipt. Return ONLY the numeric value as a JSON object: { \"amount\": 123.45 }.";
        responseSchema = {
          type: "object",
          properties: {
            amount: { type: "number" }
          },
          required: ["amount"]
        };
      }

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: image.split(',')[1]
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });

      const extracted = JSON.parse(response.text);
      res.json(extracted);
    } catch (error) {
      console.error("[SCANNER ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API Route for AI Mixologist
  app.post("/api/ai/mixologist", async (req, res) => {
    const { inStockItems } = req.body;
    if (!inStockItems) return res.status(400).json({ error: "Inventory data required" });

    try {
      console.log(`[AI] Generating drinks for items: ${inStockItems.substring(0, 50)}...`);
      
      const response = await genAI.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            parts: [{
              text: `You are a world-class mixologist at "Smoke Eaters" bar.
              Inventory Available: ${inStockItems}.
              
              TASK:
              Suggest 3 creative, high-quality cocktails we can make using ONLY the available inventory.
              
              INTELLIGENT SUBSTITUTIONS:
              If common ingredients are missing, you are ENCOURAGED to suggest standard cocktails with intelligent swaps.
              Example: If we have Tequila and Lemon but no Lime, suggest a "Lemon Margarita" and note the swap.
              
              VIBE:
              The bar "Smoke Eaters" is a rugged, yet sophisticated fire-fighter themed lounge. Give the drinks bold, characterful names.
              
              Output requirements:
              - Accurate measurements.
              - Clear, concise instructions.
              - Note any swaps made in the instructions.
              - Suggest the drinks in order of complexity (Easy, Medium, Complex).`
            }]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                category: { 
                  type: "string",
                  enum: ["Cocktail", "Shot", "Beer", "Non-Alcoholic"]
                },
                instructions: { type: "string" },
                ingredients: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      item: { type: "string" },
                      amount: { type: "string" }
                    },
                    required: ["item", "amount"]
                  }
                },
                insight: { type: "string" }
              },
              required: ["name", "category", "instructions", "ingredients", "insight"]
            }
          }
        }
      });

      const suggestions = JSON.parse(response.text);
      res.json(suggestions);
    } catch (error) {
      console.error("[AI ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API Route for Distributor Portal Sync
  app.post("/api/distributor/sync-portal", async (req, res) => {
    const { textData, imageData, distributorName, inventoryItems, mimeType } = req.body;
    
    try {
      console.log(`[SYNC] Processing portal data for ${distributorName}`);
      
      let contents: any = [];
      const basePrompt = `You are an inventory assistant. I am providing you with data from a distributor's ordering portal for "${distributorName}". 
      Extract the unit prices (cost) and out-of-stock status for items and match them to our existing inventory items for this distributor.
      Our items for ${distributorName}: ${inventoryItems}.
      If the data in the portal is for a different packaging (e.g. case price vs bottle price) than our inventory item, please calculate the equivalent unit price for our specific inventory item.
      Return a JSON array of objects with:
      - "n" (item name)
      - "c" (calculated cost as number relative to our inventory unit, optional)
      - "oos" (boolean, true if out of stock, optional)
      Only include items where you found info. 
      ONLY return the JSON.`;

      if (textData) {
        contents = [{ parts: [{ text: `${basePrompt}\n\nPortal Text Data:\n${textData}` }] }];
      } else if (imageData) {
        contents = [{
          parts: [
            { text: basePrompt },
            { inlineData: { data: imageData.split(',')[1], mimeType: mimeType || "image/jpeg" } }
          ]
        }];
      } else {
        return res.status(400).json({ error: "No data provided for sync" });
      }

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                n: { type: "string" },
                c: { type: "number" },
                oos: { type: "boolean" }
              },
              required: ["n"]
            }
          }
        }
      });

      const results = JSON.parse(response.text);
      res.json(results);
    } catch (error) {
      console.error("[SYNC ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API Route for AI Recipe Search with Web Results
  app.post("/api/ai/search-recipe", async (req, res) => {
    const { query, inStockItems, showOnlyInStock } = req.body;
    if (!query) return res.status(400).json({ error: "Query required" });

    try {
      console.log(`[AI] Searching web for recipe: ${query}`);
      
      const response = await genAI.models.generateContent({ 
        model: "gemini-3-flash-preview",
        tools: [{ googleSearch: {} }],
        contents: [{
          parts: [{
            text: `Find a detailed recipe for the drink "${query}". Search the internet for the most authentic version.
            
            Currently available inventory: ${inStockItems || 'None'}
            ${showOnlyInStock ? `CRITICAL INVENTORY CONTEXT: The user only wants recipes they can make NOW. 
            1. If "${query}" traditionally uses ingredients we don't have, find a highly-regarded "Pantry/Inventory Swap" version.
            2. Specifically look for recipes that can be made using ONLY or PRIMARILY these items: ${inStockItems}.
            3. If you must substitute, choose logical flavor profiles (e.g., lime for lemon, agave for simple syrup, etc.) based on the available inventory.` : ""}

            Return the result ONLY as a JSON object following this schema:
            { "name": string, "category": "Cocktail" | "Shot" | "Beer" | "Non-Alcoholic", "instructions": string, "ingredients": [{ "item": string, "amount": string }], "insight": string }
            
            The insight should highlight if this is a web-sourced classic or an inventory-adapted variation.`
          }]
        }],
        config: {
          responseMimeType: "application/json",
        }
      } as any);

      const recipe = JSON.parse(response.text);
      res.json(recipe);
    } catch (error) {
      console.error("[SEARCH ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API Route for AI Recipe Intelligence (Match or New)
  app.post("/api/ai/intelligent-recipe", async (req, res) => {
    const { query, inStockItems, recipesList, showOnlyInStock } = req.body;
    if (!query) return res.status(400).json({ error: "Query required" });

    try {
      console.log(`[AI] Intelligent recipe lookup: ${query}`);
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [{
            text: `You are an elite AI Bartender at "Smoke Eaters" Bar.
            Query: "${query}"
            
            Available Inventory: ${inStockItems || 'None'}
            Existing Database Recipes & their Ingredients:
            ${recipesList}

            TASK:
            1. Find if the query matches an existing recipe in our database. 
               - A match can be by name OR by ingredient similarity (e.g., if we have a "Rum & Coke" and they ask for "Cuba Libre").
               - If it matches, return "MATCH: [Recipe Name]".

            2. If no existing recipe matches well, find a recipe for this drink and ADAPT it to our inventory.
               - Substitutions are ENCOURAGED if we are missing a part of the classic recipe but have a close alternative.
               - Common Substitutions to use:
                 * Lime Juice -> Lemon Juice or Sour Mix
                 * Simple Syrup -> Honey Syrup, Agave, or Sugar + Water
                 * Triple Sec -> Orange Juice + Splash of Vodka (if needed)
                 * Club Soda -> Sprite/7-UP (adjust sweetness) or Tonic
                 * Bitters -> muddled citrus zest or spice-infused syrup
               - If you make a substitution, EXPLICITLY state it in the instructions (e.g. "Substituting Lemon for Lime as per inventory").
               - Return this as "NEW: [JSON Object]".

            CRITICAL:
            - If 'showOnlyInStock' is true, you MUST ensure every ingredient in a "NEW" recipe is present in "Available Inventory".
            - If it's false, you can suggest the standard recipe but note missing items.

            JSON Schema for NEW:
            {"name": string, "category": "Cocktail" | "Shot" | "Beer" | "Non-Alcoholic", "instructions": string, "ingredients": [{"item": string, "amount": string}], "insight": string}

            Example Output:
            MATCH: Old Fashioned
            OR
            NEW: {"name": "Inventory Margarita", "category": "Cocktail", "instructions": "Substituted Lemon for Lime: Shake and strain.", "ingredients": [{"item": "Tequila", "amount": "2 oz"}, {"item": "Lemon", "amount": "0.75 oz"}], "insight": "Uses available Lemon as a bright citrus substitute for missing Lime."}`
          }]
        }]
      });

      const text = response.text || '';
      res.json({ text });
    } catch (error) {
      console.error("[INTELLIGENT ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // API route for importing recipes from camera or screenshot
  app.post("/api/ai/scan-recipe-image", async (req, res) => {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Missing image data for recipe scan" });
    }

    try {
      console.log("[AI] Scanning recipe from image/screenshot...");
      const cleanBase64 = image.includes(',') ? image.split(',')[1] : image;
      const detectedMimeType = mimeType || (image.includes(';base64') ? image.split(';')[0].split(':')[1] : "image/jpeg");

      const response = await genAI.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            parts: [
              { text: `Analyze the provided image of a drink recipe (it could be a printout, written sheet, screenshot, or book) and extract the structured details. If the image is not a recipe, try to interpret a recipe from options or summarize it. Return a valid JSON matching the schema.` },
              { inlineData: { data: cleanBase64, mimeType: detectedMimeType } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              category: { 
                type: "string", 
                enum: ["Cocktail", "Shot", "Beer", "Wine", "Liquor", "Specialty", "Non-Alcoholic", "Other"] 
              },
              instructions: { type: "string" },
              ingredients: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    item: { type: "string" },
                    amount: { type: "string" }
                  },
                  required: ["item", "amount"]
                }
              },
              insight: { type: "string" }
            },
            required: ["name", "category", "instructions", "ingredients", "insight"]
          }
        }
      });

      const text = response.text || '{}';
      const recipe = JSON.parse(text);
      res.json(recipe);
    } catch (error) {
      console.error("[AI SCAN RECIPE ERROR]", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Serve static files and handle SPA fallback AFTER all API routes
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Express + Vite server listening on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[SERVER] Endpoints: /api/pos/test-connection, /api/pos/sync-sales, /api/pos/sync-inventory are ready.`);
  });
}

// Global error handlers for the server process
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer().catch(err => {
  console.error("[FATAL] Failed to start server:", err);
});
