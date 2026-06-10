import { NextResponse } from 'next/server';
import { scrapeIpo, IpoItem } from '@/lib/scraper';
import { sendNotifications, NotificationConfig } from '@/lib/notify';

// Date utility to get Asia/Seoul date
function getSeoulDateInfo() {
  // Get current date/time in Seoul
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  const weekday = parts.find(p => p.type === 'weekday')!.value; // "일", "월" 등

  const todayStr = `${year}-${month}-${day}`; // YYYY-MM-DD
  
  // Date math for next week
  const seoulNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const dayOfWeek = seoulNow.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  
  // Next Monday
  const daysToNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(seoulNow);
  nextMonday.setDate(seoulNow.getDate() + daysToNextMonday);
  
  // Next Sunday
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);

  const toISO = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${date}`;
  };

  return {
    today: todayStr,
    weekday,
    nextWeekStart: toISO(nextMonday),
    nextWeekEnd: toISO(nextSunday),
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Authorization Check
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // If CRON_SECRET is configured, we require matching Bearer token
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { today, weekday, nextWeekStart, nextWeekEnd } = getSeoulDateInfo();
    
    // Determine type: default is daily, but Sunday (일) defaults to weekly
    let type: 'daily' | 'weekly' = 'daily';
    const typeParam = searchParams.get('type');
    if (typeParam === 'weekly' || (typeParam !== 'daily' && weekday === '일')) {
      type = 'weekly';
    }

    // Load credentials from environment
    const config: NotificationConfig = {
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
    };

    if (!config.slackWebhookUrl && (!config.telegramBotToken || !config.telegramChatId)) {
      return NextResponse.json({
        success: false,
        message: 'No notifications configured in environment variables.',
      });
    }

    // Exclude SPAC/REIT based on environment preferences (default to exclude SPACs, include REITs)
    const excludeSpac = process.env.EXCLUDE_SPAC !== 'false';
    const excludeReit = process.env.EXCLUDE_REIT === 'true';

    const allIpos = await scrapeIpo({ excludeSpac, excludeReit });
    let sendList: IpoItem[] = [];

    if (type === 'daily') {
      // Find IPOs active today
      sendList = allIpos.filter(item => {
        return item.startDate <= today && today <= item.endDate;
      });
    } else {
      // Find IPOs starting next week
      sendList = allIpos.filter(item => {
        return item.startDate >= nextWeekStart && item.startDate <= nextWeekEnd;
      });
    }

    // If nothing to alert, we can just finish
    if (sendList.length === 0) {
      return NextResponse.json({
        success: true,
        message: `No IPO items found for ${type} alarm (${today}).`,
        sent: false,
      });
    }

    const result = await sendNotifications(config, sendList, type);
    return NextResponse.json({
      success: true,
      message: `Successfully processed ${type} alarm.`,
      sent: true,
      sentCount: sendList.length,
      result,
    });
  } catch (error: any) {
    console.error('Cron GET failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { config, type, options } = body as {
      config: NotificationConfig;
      type: 'daily' | 'weekly' | 'test';
      options?: { excludeSpac?: boolean; excludeReit?: boolean };
    };

    if (!config || (!config.slackWebhookUrl && (!config.telegramBotToken || !config.telegramChatId))) {
      return NextResponse.json(
        { success: false, error: 'Slack Webhook URL or Telegram Bot credentials are required' },
        { status: 400 }
      );
    }

    const { today, nextWeekStart, nextWeekEnd } = getSeoulDateInfo();
    const allIpos = await scrapeIpo({
      excludeSpac: options?.excludeSpac,
      excludeReit: options?.excludeReit,
    });

    let sendList: IpoItem[] = [];

    if (type === 'test') {
      // For test, just send the first 3 items or everything
      sendList = allIpos.slice(0, 3);
    } else if (type === 'daily') {
      sendList = allIpos.filter(item => item.startDate <= today && today <= item.endDate);
    } else if (type === 'weekly') {
      sendList = allIpos.filter(item => item.startDate >= nextWeekStart && item.startDate <= nextWeekEnd);
    }

    const result = await sendNotifications(config, sendList, type);
    return NextResponse.json({
      success: true,
      sentCount: sendList.length,
      result,
    });
  } catch (error: any) {
    console.error('Cron POST failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
