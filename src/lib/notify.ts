import axios from 'axios';
import { IpoItem } from './scraper';
import webPush from 'web-push';


export interface NotificationConfig {
  slackWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

function buildMessage(sendList: IpoItem[], type: 'daily' | 'weekly' | 'test'): string {
  let title = '';
  if (type === 'daily') {
    title = '📢 [오늘의 공모주 청약 일정]';
  } else if (type === 'weekly') {
    title = '🗓️ [다음주 공모주 청약 예정 일정]';
  } else {
    title = '🔔 [공모주 청약 알림 봇 테스트 발송]';
  }

  let message = `${title}\n\n`;

  if (sendList.length === 0) {
    message += '진행 예정인 공모주 청약 일정이 없습니다.\n';
    return message;
  }

  sendList.forEach((item, index) => {
    message += `*${index + 1}. ${item.company}*\n`;
    message += `• 청약일정: ${item.date}\n`;
    message += `• 확정공모가: ${item.finalPrice}원\n`;
    message += `• 희망공모가: ${item.hopePrice}원\n`;
    message += `• 주간사: ${item.broker}\n\n`;
  });

  return message;
}

export async function sendSlackNotification(webhookUrl: string, message: string): Promise<boolean> {
  try {
    await axios.post(webhookUrl, {
      text: message,
    });
    return true;
  } catch (error) {
    console.error('Slack notification failed:', error);
    return false;
  }
}

export async function sendTelegramNotification(botToken: string, chatId: string, message: string): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });
    return true;
  } catch (error) {
    // If Markdown parsing fails due to special characters, fallback to plain text
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await axios.post(url, {
        chat_id: chatId,
        text: message.replace(/[*_`\[\]()]/g, ''), // Strip markdown characters
      });
      return true;
    } catch (fallbackError) {
      console.error('Telegram notification failed:', fallbackError);
      return false;
    }
  }
}

export async function sendNotifications(
  config: NotificationConfig,
  sendList: IpoItem[],
  type: 'daily' | 'weekly' | 'test'
): Promise<{ slackSuccess: boolean; telegramSuccess: boolean }> {
  const message = buildMessage(sendList, type);
  let slackSuccess = false;
  let telegramSuccess = false;

  if (config.slackWebhookUrl) {
    slackSuccess = await sendSlackNotification(config.slackWebhookUrl, message);
  }

  if (config.telegramBotToken && config.telegramChatId) {
    telegramSuccess = await sendTelegramNotification(config.telegramBotToken, config.telegramChatId, message);
  }

  return { slackSuccess, telegramSuccess };
}

// VAPID Setup
const vapidKeys = {
  publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
};

if (vapidKeys.publicKey && vapidKeys.privateKey) {
  try {
    webPush.setVapidDetails(
      'mailto:ehomekorea.netizen@gmail.com',
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
  } catch (err) {
    console.error('Failed to set VAPID details:', err);
  }
}

export async function sendWebPushNotification(
  subscription: any,
  title: string,
  body: string,
  url: string = '/'
): Promise<boolean> {
  try {
    if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
      console.warn('VAPID keys not configured. Skipping Web Push.');
      return false;
    }
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon.png',
      url,
    });
    await webPush.sendNotification(subscription, payload);
    return true;
  } catch (error) {
    console.error('Web Push notification failed:', error);
    return false;
  }
}

