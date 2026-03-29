/**
 * PDF generation service using Puppeteer.
 * Converts HTML to PDF for download/print.
 */

import type { Browser } from 'puppeteer';

let browserInstance: Browser | null = null;

/**
 * Get or create a shared Puppeteer browser instance.
 * Reuses the browser across requests to avoid launch overhead.
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    try {
      // Verify it's still connected
      browserInstance.pages();
      return browserInstance;
    } catch {
      browserInstance = null;
    }
  }

  const puppeteer = await import('puppeteer');
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  return browserInstance;
}

/**
 * Convert HTML string to PDF buffer.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      printBackground: true,
      preferCSSPageSize: false,
    });

    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/**
 * Cleanup browser instance. Call on process shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

// Prevent browser leaks on process shutdown
process.on('SIGTERM', () => { closeBrowser().catch(() => {}); });
process.on('SIGINT', () => { closeBrowser().catch(() => {}); });
