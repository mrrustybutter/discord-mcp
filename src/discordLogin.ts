import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LoginResult {
  success: boolean;
  token?: string;
  cookie?: string;
  error?: string;
}

export class DiscordLogin {
  private browser?: Browser;
  private page?: Page;

  async login(username: string, password: string): Promise<LoginResult> {
    try {
      console.error('[Discord Login] Starting browser...');
      
      // Launch browser with Discord-like user agent
      this.browser = await puppeteer.launch({
        headless: process.env.DISCORD_LOGIN_HEADLESS !== 'false', // Headless by default
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });

      this.page = await this.browser.newPage();
      
      // Set user agent to match Chrome
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36');
      
      // Set viewport
      await this.page.setViewport({ width: 1920, height: 1080 });

      // Remove webdriver property
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
      });

      // Navigate to Discord login
      console.error('[Discord Login] Navigating to Discord...');
      await this.page.goto('https://discord.com/login', { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Wait for login form
      await this.page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await this.page.waitForSelector('input[name="password"]', { timeout: 10000 });

      // Type username
      console.error('[Discord Login] Entering credentials...');
      await this.page.type('input[name="email"]', username, { delay: 100 });
      
      // Type password
      await this.page.type('input[name="password"]', password, { delay: 100 });

      // Click login button
      await this.page.click('button[type="submit"]');

      // Wait for navigation or captcha
      console.error('[Discord Login] Waiting for login response...');
      
      try {
        // Wait for either successful login or captcha
        await Promise.race([
          this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
          this.page.waitForSelector('iframe[src*="hcaptcha"]', { timeout: 30000 }),
          this.page.waitForSelector('[class*="captcha"]', { timeout: 30000 })
        ]);
      } catch (e) {
        console.error('[Discord Login] Navigation timeout, checking current state...');
      }

      // Check if we need to handle captcha
      const captchaFrame = await this.page.$('iframe[src*="hcaptcha"]');
      if (captchaFrame) {
        console.error('[Discord Login] CAPTCHA detected! Please solve it manually...');
        // Wait for user to solve captcha
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 });
      }

      // Check if we're logged in by looking for the app
      const isLoggedIn = await this.page.evaluate(() => {
        return window.location.pathname.includes('/channels') || 
               window.location.pathname.includes('/app') ||
               document.querySelector('[class*="app-"]') !== null;
      });

      if (!isLoggedIn) {
        throw new Error('Login failed - not redirected to app');
      }

      console.error('[Discord Login] Successfully logged in!');

      // Get cookies
      const cookies = await this.page.cookies();
      const cookieString = cookies
        .map((cookie: any) => `${cookie.name}=${cookie.value}`)
        .join('; ');

      // Wait a bit for Discord to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to extract token using webpack method
      const token = await this.page.evaluate(() => {
        try {
          // Method 1: Try webpack chunk extraction (most reliable)
          if ((window as any).webpackChunkdiscord_app) {
            let tokens: string[] = [];
            (window as any).webpackChunkdiscord_app.push([[0],,
              (e: any) => Object.keys(e.c).find((t: any) => {
                const module = e(t);
                const token = module?.default?.getToken?.();
                if (token && typeof token === 'string') {
                  tokens.push(token);
                }
              })
            ]);
            if (tokens.length > 0) {
              console.log('[Token Extract] Found token via webpack method');
              return tokens[0];
            }
          }
          
          // Method 2: Alternative webpack approach
          if ((window as any).webpackChunkdiscord_app) {
            const modules: any[] = [];
            (window as any).webpackChunkdiscord_app.push([[''], {}, 
              (e: any) => {
                for (let c in e.c) modules.push(e.c[c]);
              }
            ]);
            
            const tokenModule = modules.find((m: any) => m?.exports?.default?.getToken !== undefined);
            if (tokenModule) {
              const token = tokenModule.exports.default.getToken();
              if (token) {
                console.log('[Token Extract] Found token via alternative webpack method');
                return token;
              }
            }
          }
          
          // Method 3: Check localStorage (may not work on newer Discord)
          const localToken = (window as any).localStorage?.token;
          if (localToken) {
            console.log('[Token Extract] Found token in localStorage');
            return localToken.replace(/"/g, '');
          }
          
          // Method 4: Try to find in window object
          const windowKeys = Object.keys(window);
          for (const key of windowKeys) {
            if (key.toLowerCase().includes('token') && typeof (window as any)[key] === 'string') {
              const value = (window as any)[key];
              // Check if it looks like a Discord token
              if (value.length > 50 && value.includes('.')) {
                console.log('[Token Extract] Found token in window object');
                return value;
              }
            }
          }
        } catch (e) {
          console.error('[Token Extract] Error:', e);
        }
        
        return null;
      });

      // Save cookies to file for future use
      const cookieFile = path.join(__dirname, '..', 'discord_cookies.json');
      await fs.writeFile(cookieFile, JSON.stringify({
        cookies: cookies,
        cookieString: cookieString,
        token: token,
        timestamp: new Date().toISOString()
      }, null, 2));

      console.error('[Discord Login] Saved authentication data');

      // Close the browser now that we have what we need
      await this.close();

      return {
        success: true,
        token: token || undefined,
        cookie: cookieString
      };

    } catch (error) {
      console.error('[Discord Login] Error:', error);
      
      // Make sure to close browser on error too
      await this.close();
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}