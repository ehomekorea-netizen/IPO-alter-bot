const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

function parseDateRange(dateStr) {
  try {
    const parts = dateStr.split('~');
    if (parts.length !== 2) {
      return { startDate: '', endDate: '' };
    }

    const startPart = parts[0].trim();
    const endPart = parts[1].trim();

    const startDots = startPart.split('.');
    if (startDots.length !== 3) {
      return { startDate: '', endDate: '' };
    }
    const year = parseInt(startDots[0], 10);
    const startMonth = parseInt(startDots[1], 10);
    const startDay = parseInt(startDots[2], 10);

    const formattedStartDate = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;

    let formattedEndDate = '';
    const endDots = endPart.split('.');
    if (endDots.length === 3) {
      formattedEndDate = `${endDots[0]}-${String(parseInt(endDots[1], 10)).padStart(2, '0')}-${String(parseInt(endDots[2], 10)).padStart(2, '0')}`;
    } else if (endDots.length === 2) {
      const endMonth = parseInt(endDots[0], 10);
      const endDay = parseInt(endDots[1], 10);

      let endYear = year;
      if (endMonth < startMonth) {
        endYear = year + 1;
      }

      formattedEndDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    } else {
      formattedEndDate = formattedStartDate;
    }

    return { startDate: formattedStartDate, endDate: formattedEndDate };
  } catch (error) {
    console.error('Error parsing date range:', dateStr, error);
    return { startDate: '', endDate: '' };
  }
}

async function runTest() {
  try {
    console.log('Testing scraper logic...');
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
    const ipoList = [];
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

    console.log(`Parsed ${ipoList.length} items.`);
    console.log('Sample item:', ipoList[0]);
    console.log('Success!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest();
