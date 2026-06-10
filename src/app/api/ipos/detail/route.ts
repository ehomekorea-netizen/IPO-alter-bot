import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const company = searchParams.get('company');

    if (!url) {
      return NextResponse.json({ success: false, error: 'URL parameter is required' }, { status: 400 });
    }

    // 1. Scrape 38.co.kr Detail Page
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const html = iconv.decode(Buffer.from(response.data), 'euc-kr');
    const $ = cheerio.load(html);

    const details: Record<string, string> = {};
    const targetLabels = [
      '업종',
      '시장구분',
      '종목코드',
      '대표자',
      '매출액',
      '순이익',
      '총공모주식수',
      '액면가',
      '기관경쟁률',
      '의무보유확약',
      '환불일',
      '상장일',
      '납입일',
    ];

    $('td').each((_, el) => {
      const cellText = $(el).text().replace(/\s+/g, ' ').trim();
      targetLabels.forEach(label => {
        if (cellText === label) {
          const val = $(el).next().text().replace(/\s+/g, ' ').trim();
          // If value is found, store it
          if (val) {
            details[label] = val;
          }
        }
      });
    });

    // 2. Fetch Google News RSS for the company
    const newsList: Array<{ title: string; link: string; press: string; pubDate: string }> = [];
    if (company) {
      try {
        const query = company.replace('(구.', ' ').replace(')', ''); // Clean up name for query
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
        
        const rssResponse = await axios.get(rssUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        const $rss = cheerio.load(rssResponse.data, { xmlMode: true });
        $rss('item')
          .slice(0, 5)
          .each((_, itemEl) => {
            const item = $rss(itemEl);
            const title = item.find('title').text().trim();
            const link = item.find('link').text().trim();
            const pubDate = item.find('pubDate').text().trim();
            const source = item.find('source').text().trim();

            if (title && link) {
              const titleParts = title.split(' - ');
              const cleanTitle = titleParts.slice(0, -1).join(' - ') || title;
              const press = titleParts[titleParts.length - 1] || source;

              newsList.push({
                title: cleanTitle,
                link,
                press,
                pubDate,
              });
            }
          });
      } catch (newsError) {
        console.error('Failed to fetch news for:', company, newsError);
      }
    }

    return NextResponse.json({
      success: true,
      details,
      news: newsList,
    });
  } catch (error: any) {
    console.error('API /api/ipos/detail failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch details' },
      { status: 500 }
    );
  }
}
