import puppeteer, { Browser, Page } from 'puppeteer';

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: false, // Show browser UI so user can see what's happening
        defaultViewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.page = await this.browser.newPage();
    }
  }

  async search(query: string): Promise<string> {
      await this.init();
      if (!this.page) return 'Browser not initialized';
      
      try {
          // Use DuckDuckGo for simpler scraping
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          await this.page.goto(url, { waitUntil: 'networkidle0' });
          
          const results = await this.page.evaluate(() => {
              const items = Array.from(document.querySelectorAll('.result__body'));
              return items.map(item => {
                  const titleEl = item.querySelector('.result__a');
                  const snippetEl = item.querySelector('.result__snippet');
                  const url = (titleEl as HTMLAnchorElement)?.href;
                  const title = titleEl?.textContent?.trim();
                  const snippet = snippetEl?.textContent?.trim();
                  
                  if (title && url) {
                      return `### ${title}\nURL: ${url}\n${snippet || ''}\n`;
                  }
                  return '';
              }).filter(Boolean).join('\n');
          });
          
          if (!results) return 'No results found';
          return `Search Results for "${query}":\n\n${results}`;
      } catch (e: any) {
          return `Search error: ${e.message}`;
      }
  }

  async navigate(url: string): Promise<string> {
    await this.init();
    if (this.page) {
      await this.page.goto(url, { waitUntil: 'networkidle0' });
      return await this.getPageContent();
    }
    return 'Browser not initialized';
  }

  async getPageContent(): Promise<string> {
    if (!this.page) return 'No page open';
    
    // Convert page content to simplified Markdown-like text
    const content = await this.page.evaluate(() => {
        // Helper to get visible text
        function getVisibleText(element: Element): string {
            if (!(element as HTMLElement).offsetParent) return '';
            
            let text = '';
            
            // Handle inputs
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                const el = element as HTMLInputElement;
                const type = el.type || '';
                if (type === 'submit' || type === 'button') {
                     return `[BUTTON: ${el.value || 'Submit'}] `;
                }
                return `[INPUT: ${el.placeholder || el.name || 'text'} (current: ${el.value})] `;
            }
            
            // Handle links
            if (element.tagName === 'A') {
                const href = (element as HTMLAnchorElement).href;
                return `[LINK: ${element.textContent?.trim()} (${href})] `;
            }
            
            // Handle buttons
            if (element.tagName === 'BUTTON') {
                return `[BUTTON: ${element.textContent?.trim()}] `;
            }

            // Recurse
            for (const child of Array.from(element.children)) {
                text += getVisibleText(child);
            }
            
            if (element.children.length === 0) {
                text += element.textContent?.trim() + ' ';
            }
            
            // Add structure
            const tag = element.tagName;
            if (['P', 'DIV', 'H1', 'H2', 'H3', 'LI', 'BR'].includes(tag)) {
                text += '\n';
            }
            
            return text;
        }
        
        return document.body.innerText; // Simple fallback for now, or implement better scraping
    });
    
    return content;
  }

  async type(selector: string, text: string): Promise<string> {
      if (!this.page) return 'No page open';
      try {
          await this.page.type(selector, text);
          return `Typed "${text}" into ${selector}`;
      } catch (e: any) {
          return `Error typing: ${e.message}`;
      }
  }

  async click(selector: string): Promise<string> {
      if (!this.page) return 'No page open';
      try {
          await this.page.click(selector);
          // Wait for navigation or update
          try {
              await this.page.waitForNavigation({ timeout: 5000, waitUntil: 'networkidle0' });
          } catch {
              // Ignore timeout if no navigation happened
          }
          return `Clicked ${selector}`;
      } catch (e: any) {
          return `Error clicking: ${e.message}`;
      }
  }
  
  async screenshot(path: string): Promise<string> {
      if (!this.page) return 'No page open';
      await this.page.screenshot({ path });
      return `Screenshot saved to ${path}`;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
