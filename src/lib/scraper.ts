import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export interface IpoItem {
  company: string;
  date: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  finalPrice: string;
  hopePrice: string;
  broker: string;
  isSpac: boolean;
  isReit: boolean;
}

export interface ScrapeOptions {
  excludeSpac?: boolean;
  excludeReit?: boolean;
}

/**
 * Parses a date range string like "2026.06.24~06.25" or "2026.12.30~01.02"
 * into ISO date strings (YYYY-MM-DD) for start and end dates.
 */
function parseDateRange(dateStr: string): { startDate: string; endDate: string } {
  try {
    const parts = dateStr.split('~');
    if (parts.length !== 2) {
      return { startDate: '', endDate: '' };
    }

    const startPart = parts[0].trim(); // e.g. "2026.06.24"
    const endPart = parts[1].trim();   // e.g. "06.25" or "2026.06.25" (sometimes website includes full date)

    // Normalize start date to YYYY-MM-DD
    const startDots = startPart.split('.');
    if (startDots.length !== 3) {
      return { startDate: '', endDate: '' };
    }
    const year = parseInt(startDots[0], 10);
    const startMonth = parseInt(startDots[1], 10);
    const startDay = parseInt(startDots[2], 10);

    const formattedStartDate = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;

    let formattedEndDate = '';

    // Check if end part has year (contains 2 dots, e.g. "2026.06.25")
    const endDots = endPart.split('.');
    if (endDots.length === 3) {
      formattedEndDate = `${endDots[0]}-${String(parseInt(endDots[1], 10)).padStart(2, '0')}-${String(parseInt(endDots[2], 10)).padStart(2, '0')}`;
    } else if (endDots.length === 2) {
      // e.g. "06.25"
      const endMonth = parseInt(endDots[0], 10);
      const endDay = parseInt(endDots[1], 10);

      // Handle year crossing (e.g. start is Dec 30, end is Jan 02)
      let endYear = year;
      if (endMonth < startMonth) {
        endYear = year + 1;
      }

      formattedEndDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    } else {
      // Fallback
      formattedEndDate = formattedStartDate;
    }

    return { startDate: formattedStartDate, endDate: formattedEndDate };
  } catch (error) {
    console.error('Error parsing date range:', dateStr, error);
    return { startDate: '', endDate: '' };
  }
}

export async function scrapeIpo(options: ScrapeOptions = {}): Promise<IpoItem[]> {
  try {
    const url = 'http://www.38.co.kr/html/fund/index.htm?o=k';
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const html = iconv.decode(Buffer.from(response.data), 'euc-kr');
    const $ = cheerio.load(html);
    const ipoList: IpoItem[] = [];
    const dateRegex = /\d{4}\.\d{2}\.\d{2}~\d{2}\.\d{2}/;

    $('tr').each((_, el) => {
      const row = $(el);
      const tds = row.find('> td');
      if (tds.length >= 6) {
        const company = $(tds[0]).text().trim();
        const date = $(tds[1]).text().trim();
        const finalPrice = $(tds[2]).text().trim();
        const hopePrice = $(tds[3]).text().trim();
        const broker = $(tds[5]).text().trim();

        if (dateRegex.test(date)) {
          const isSpac = company.includes('스팩') || company.toUpperCase().includes('SPAC');
          const isReit = company.includes('리츠') || company.toUpperCase().includes('REIT');

          if (options.excludeSpac && isSpac) return;
          if (options.excludeReit && isReit) return;

          const { startDate, endDate } = parseDateRange(date);

          ipoList.push({
            company,
            date,
            startDate,
            endDate,
            finalPrice,
            hopePrice,
            broker,
            isSpac,
            isReit,
          });
        }
      }
    });

    return ipoList;
  } catch (error) {
    console.error('Scrape failed:', error);
    throw error;
  }
}
