'use client';

import React, { useState, useEffect } from 'react';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface SettingsConfig {
  slackWebhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  excludeSpac: boolean;
  excludeReit: boolean;
}

interface SettingsProps {
  onSettingsChange?: (settings: SettingsConfig) => void;
  uid?: string;
}

export default function Settings({ onSettingsChange, uid }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsConfig>({
    slackWebhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    excludeSpac: true,
    excludeReit: false,
  });

  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      // 1. Try to load from Firestore first if logged in
      if (uid && isFirebaseConfigured && db) {
        try {
          const userRef = doc(db, 'users', uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.settings) {
              const merged = { ...settings, ...userData.settings };
              setSettings(merged);
              if (onSettingsChange) {
                onSettingsChange(merged);
              }
              return;
            }
          }
        } catch (e) {
          console.error('Failed to load settings from Firestore:', e);
        }
      }

      // 2. Fallback to LocalStorage
      const saved = localStorage.getItem('ipo_bot_settings');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const merged = { ...settings, ...parsed };
          setSettings(merged);
          if (onSettingsChange) {
            onSettingsChange(merged);
          }
        } catch (e) {
          console.error('Failed to parse settings', e);
        }
      }
    };

    loadSettings();
  }, [uid]);

  const saveSettings = async (newSettings: SettingsConfig) => {
    setSettings(newSettings);
    
    // Save to LocalStorage for fallback
    localStorage.setItem('ipo_bot_settings', JSON.stringify(newSettings));
    
    // Save to Firestore if logged in
    if (uid && isFirebaseConfigured && db) {
      try {
        const userRef = doc(db, 'users', uid);
        await setDoc(userRef, { settings: newSettings }, { merge: true });
      } catch (e) {
        console.error('Failed to save settings to Firestore:', e);
      }
    }

    if (onSettingsChange) {
      onSettingsChange(newSettings);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    const updated = { ...settings, [name]: val };
    saveSettings(updated);
  };

  const triggerNotification = async (type: 'test' | 'daily' | 'weekly') => {
    setLoading(true);
    setTestResult(null);
    try {
      const payload: any = {
        type,
      };

      if (uid) {
        payload.uid = uid;
      } else {
        payload.config = {
          slackWebhookUrl: settings.slackWebhookUrl || undefined,
          telegramBotToken: settings.telegramBotToken || undefined,
          telegramChatId: settings.telegramChatId || undefined,
        };
        payload.options = {
          excludeSpac: settings.excludeSpac,
          excludeReit: settings.excludeReit,
        };
      }

      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        let successMsg = '';
        if (type === 'test') {
          successMsg = '테스트 알림 발송 성공!';
        } else if (type === 'daily') {
          successMsg = `오늘 일정 발송 완료! (총 ${data.sentCount}건)`;
        } else {
          successMsg = `다음주 일정 발송 완료! (총 ${data.sentCount}건)`;
        }

        const slackStatus = data.result?.slackSuccess ? 'Slack:성공' : 'Slack:안됨';
        const telegramStatus = data.result?.telegramSuccess ? 'Tele:성공' : 'Tele:안됨';
        const webPushStatus = data.result?.webPushSuccess ? 'WebPush:성공' : 'WebPush:안됨';

        setTestResult({
          success: true,
          message: `${successMsg} (${slackStatus}, ${telegramStatus}, ${webPushStatus})`,
        });
      } else {
        setTestResult({
          success: false,
          message: `발송 실패: ${data.error || '오류'}`,
        });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: `네트워크 오류: ${error.message || '오류'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Slack Section */}
      <div className="app-card" style={{ cursor: 'default' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: '#38bdf8', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>💬</span> Slack 알림 설정
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="slackWebhookUrl" style={{ fontSize: '0.75rem' }}>Incoming Webhook URL</label>
          <input
            type="text"
            id="slackWebhookUrl"
            name="slackWebhookUrl"
            value={settings.slackWebhookUrl}
            onChange={handleInputChange}
            placeholder="https://hooks.slack.com/services/..."
            style={{ fontSize: '0.8rem' }}
          />
        </div>
      </div>

      {/* Telegram Section */}
      <div className="app-card" style={{ cursor: 'default' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: '#3b82f6', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>✈️</span> Telegram 알림 설정
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label htmlFor="telegramBotToken" style={{ fontSize: '0.75rem' }}>Bot Token</label>
            <input
              type="password"
              id="telegramBotToken"
              name="telegramBotToken"
              value={settings.telegramBotToken}
              onChange={handleInputChange}
              placeholder="봇 토큰 입력"
              style={{ fontSize: '0.8rem' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label htmlFor="telegramChatId" style={{ fontSize: '0.75rem' }}>Chat ID</label>
            <input
              type="text"
              id="telegramChatId"
              name="telegramChatId"
              value={settings.telegramChatId}
              onChange={handleInputChange}
              placeholder="채팅방 ID 입력"
              style={{ fontSize: '0.8rem' }}
            />
          </div>
        </div>
      </div>

      {/* Filtering Section */}
      <div className="app-card" style={{ cursor: 'default' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: '#a78bfa', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>🔍</span> 필터 및 제외 설정
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="flex-between">
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>스팩(SPAC) 종목 제외</span>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>스팩 종목을 목록에서 제외합니다.</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                name="excludeSpac"
                checked={settings.excludeSpac}
                onChange={handleInputChange}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="flex-between">
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>리츠(REITs) 종목 제외</span>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>리츠 종목을 목록에서 제외합니다.</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                name="excludeReit"
                checked={settings.excludeReit}
                onChange={handleInputChange}
              />
              <span className="slider"></span>
            </label>
          </div>
        </div>
      </div>

      {/* Manual Actions */}
      <div className="app-card" style={{ cursor: 'default' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: '#10b981', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>⚡</span> 수동 알림 즉시 발송
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginBottom: '0.75rem' }}>
          <button
            onClick={() => triggerNotification('test')}
            disabled={loading}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.5rem 0.25rem' }}
          >
            테스트 발송
          </button>
          <button
            onClick={() => triggerNotification('daily')}
            disabled={loading}
            className="btn btn-primary"
            style={{ fontSize: '0.75rem', padding: '0.5rem 0.25rem' }}
          >
            오늘 일정
          </button>
          <button
            onClick={() => triggerNotification('weekly')}
            disabled={loading}
            className="btn btn-primary"
            style={{ fontSize: '0.75rem', padding: '0.5rem 0.25rem' }}
          >
            다음주 일정
          </button>
        </div>

        {testResult && (
          <div
            style={{
              padding: '0.6rem',
              borderRadius: '0.5rem',
              fontSize: '0.75rem',
              textAlign: 'center',
              background: testResult.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              color: testResult.success ? '#34d399' : '#f87171',
              border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`,
            }}
          >
            {testResult.message}
          </div>
        )}
      </div>
    </div>
  );
}

