import { NextResponse } from 'next/server';
import { scrapeIpo, IpoItem } from '@/lib/scraper';
import { sendNotifications, sendWebPushNotification, NotificationConfig } from '@/lib/notify';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';

// Date utility to get Asia/Seoul date
function getSeoulDateInfo() {
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
  const weekday = parts.find(p => p.type === 'weekday')!.value;

  const todayStr = `${year}-${month}-${day}`;
  
  const seoulNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const dayOfWeek = seoulNow.getDay();
  
  const daysToNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(seoulNow);
  nextMonday.setDate(seoulNow.getDate() + daysToNextMonday);
  
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

    if (!isFirebaseConfigured || !db) {
      return NextResponse.json({
        success: false,
        message: 'Firebase is not configured on the server.',
      });
    }


    const { today, weekday, nextWeekStart, nextWeekEnd } = getSeoulDateInfo();
    
    let type: 'daily' | 'weekly' = 'daily';
    const typeParam = searchParams.get('type');
    if (typeParam === 'weekly' || (typeParam !== 'daily' && weekday === '일')) {
      type = 'weekly';
    }

    // 1. Fetch all users from Firestore
    const usersCol = collection(db, 'users');
    const userSnap = await getDocs(usersCol);

    if (userSnap.empty) {
      return NextResponse.json({
        success: true,
        message: `No users registered in database (${today}).`,
        sent: false,
      });
    }

    // 2. Scrape the full list of IPOs (include everything, filter per user)
    const allIpos = await scrapeIpo({ excludeSpac: false, excludeReit: false });
    
    let sentCount = 0;
    const details = [];

    // 3. Send alerts to each user based on their specific configuration
    for (const userDoc of userSnap.docs) {
      const userData = userDoc.data();
      const settings = userData.settings || {};
      const subscription = userData.subscription;

      const excludeSpac = settings.excludeSpac !== false;
      const excludeReit = settings.excludeReit === true;

      // Filter for this user's preferences
      let userIpos = allIpos.filter(item => {
        if (excludeSpac && item.isSpac) return false;
        if (excludeReit && item.isReit) return false;
        return true;
      });

      let sendList: IpoItem[] = [];
      if (type === 'daily') {
        const pushTiming = settings.pushTiming || 'both';
        sendList = userIpos.filter(item => {
          if (pushTiming === 'start') {
            return item.startDate === today;
          } else if (pushTiming === 'end') {
            return item.endDate === today;
          } else {
            return item.startDate <= today && today <= item.endDate;
          }
        });
      } else {
        sendList = userIpos.filter(item => item.startDate >= nextWeekStart && item.startDate <= nextWeekEnd);
      }


      if (sendList.length === 0) {
        continue;
      }

      // 4. Configure & Send notifications
      const config: NotificationConfig = {
        slackWebhookUrl: settings.slackWebhookUrl || undefined,
        telegramBotToken: settings.telegramBotToken || undefined,
        telegramChatId: settings.telegramChatId || undefined,
      };

      const hasExternalNotify = config.slackWebhookUrl || (config.telegramBotToken && config.telegramChatId);
      let extResult = { slackSuccess: false, telegramSuccess: false };
      
      if (hasExternalNotify) {
        extResult = await sendNotifications(config, sendList, type);
      }

      let webPushSuccess = false;
      if (subscription) {
        const title = type === 'daily' ? '📢 오늘 청약 진행 중!' : '🗓️ 다음주 청약 예정 일정!';
        const desc = `${sendList[0].company}${sendList.length > 1 ? ` 외 ${sendList.length - 1}건` : ''}의 청약 소식이 있습니다.`;
        webPushSuccess = await sendWebPushNotification(subscription, title, desc, '/');
      }

      if (hasExternalNotify || webPushSuccess) {
        sentCount++;
      }

      details.push({
        uid: userDoc.id,
        email: userData.email || null,
        slack: extResult.slackSuccess,
        telegram: extResult.telegramSuccess,
        webPush: webPushSuccess,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${type} alarm for multiple users.`,
      sent: true,
      sentCount,
      details,
    });
  } catch (error: any) {
    console.error('Cron GET failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, config, type, options, subscription } = body as {
      uid?: string;
      config?: NotificationConfig;
      type: 'daily' | 'weekly' | 'test';
      options?: { excludeSpac?: boolean; excludeReit?: boolean; pushTiming?: 'both' | 'start' | 'end' };
      subscription?: any;
    };

    let finalConfig: NotificationConfig = {};
    let finalOptions = options || { excludeSpac: true, excludeReit: false, pushTiming: 'both' };
    let finalSubscription: any = subscription;

    // Resolve credentials from Firestore if uid is supplied
    if (uid && isFirebaseConfigured && db) {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const userSettings = userData.settings || {};
        finalConfig = {
          slackWebhookUrl: userSettings.slackWebhookUrl || undefined,
          telegramBotToken: userSettings.telegramBotToken || undefined,
          telegramChatId: userSettings.telegramChatId || undefined,
        };
        finalOptions = {
          excludeSpac: userSettings.excludeSpac !== false,
          excludeReit: userSettings.excludeReit === true,
          pushTiming: userSettings.pushTiming || 'both',
        };
        finalSubscription = userData.subscription || null;
      }
    } else if (config) {
      finalConfig = config;
    }

    const { today, nextWeekStart, nextWeekEnd } = getSeoulDateInfo();
    const allIpos = await scrapeIpo({
      excludeSpac: finalOptions.excludeSpac,
      excludeReit: finalOptions.excludeReit,
    });

    let sendList: IpoItem[] = [];
    const pushTiming = finalOptions.pushTiming || 'both';

    if (type === 'test') {
      sendList = allIpos.slice(0, 3);
    } else if (type === 'daily') {
      sendList = allIpos.filter(item => {
        if (pushTiming === 'start') {
          return item.startDate === today;
        } else if (pushTiming === 'end') {
          return item.endDate === today;
        } else {
          return item.startDate <= today && today <= item.endDate;
        }
      });
    } else if (type === 'weekly') {
      sendList = allIpos.filter(item => item.startDate >= nextWeekStart && item.startDate <= nextWeekEnd);
    }


    let extResult = { slackSuccess: false, telegramSuccess: false };
    const hasExternalNotify = finalConfig.slackWebhookUrl || (finalConfig.telegramBotToken && finalConfig.telegramChatId);
    if (hasExternalNotify && sendList.length > 0) {
      extResult = await sendNotifications(finalConfig, sendList, type);
    }

    let webPushSuccess = false;
    if (finalSubscription && sendList.length > 0) {
      const title = type === 'test' ? '🔔 알림 테스트' : type === 'daily' ? '📢 오늘 청약 진행 중!' : '🗓️ 다음주 청약 예정 일정!';
      const desc = `${sendList[0].company}${sendList.length > 1 ? ` 외 ${sendList.length - 1}건` : ''}의 청약 소식이 있습니다.`;
      webPushSuccess = await sendWebPushNotification(finalSubscription, title, desc, '/');
    }

    return NextResponse.json({
      success: true,
      sentCount: sendList.length,
      result: {
        ...extResult,
        webPushSuccess,
      },
    });
  } catch (error: any) {
    console.error('Cron POST failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

