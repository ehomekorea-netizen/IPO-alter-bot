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
  pushTiming: 'both' | 'start' | 'end';
}

interface SettingsProps {
  onSettingsChange?: (settings: SettingsConfig) => void;
  uid?: string;
  notificationPermission?: string;
  requestNotificationPermission?: () => Promise<void>;
}

export default function Settings({ 
  onSettingsChange, 
  uid, 
  notificationPermission = 'default', 
  requestNotificationPermission 
}: SettingsProps) {
  const [settings, setSettings] = useState<SettingsConfig>({
    slackWebhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    excludeSpac: true,
    excludeReit: false,
    pushTiming: 'both',
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
      // Get current service worker push subscription for instant testing
      let subscription = null;
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          if (sub) {
            subscription = sub.toJSON();
          }
        } catch (e) {
          console.warn('Failed to resolve SW subscription for test trigger:', e);
        }
      }

      const payload = {
        type,
        config: {
          slackWebhookUrl: settings.slackWebhookUrl || undefined,
          telegramBotToken: settings.telegramBotToken || undefined,
          telegramChatId: settings.telegramChatId || undefined,
        },
        options: {
          excludeSpac: settings.excludeSpac,
          excludeReit: settings.excludeReit,
          pushTiming: settings.pushTiming,
        },
        subscription,
      };

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
      {/* 1. OS Web Push Notification Section */}
      <div className="app-card" style={{ cursor: 'default' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', fontWeight: '700', color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>🔔</span> OS 웹 푸시 알림
        </h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: '1.4' }}>
          구독 시, 브라우저가 완전히 꺼져있거나 스마트폰이 대기 상태여도 기기 네이티브 알림 배너로 청약 소식을 매일 아침 수신합니다.
        </p>
        {notificationPermission === 'granted' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.8rem', fontWeight: '600' }}>
              <span>✓</span> 기기 웹 푸시 알림이 활성화되어 있습니다.
            </div>
            <button 
              className="btn btn-secondary" 
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', marginTop: '0.25rem' }} 
              onClick={requestNotificationPermission}
            >
              알림 구독 정보 다시 동기화
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={requestNotificationPermission}>
            네이티브 배너 알림 구독
          </button>
        )}
      </div>

      {/* 2. Alarm Timing Section */}
      <div className="app-card" style={{ cursor: 'default' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: '#10b981', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>⏰</span> 알림 수신 시점 설정
        </h3>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.9rem', lineHeight: '1.4' }}>
          스케줄러가 매일 아침 작동할 때, 언제 기기 알림(웹 푸시)을 수신할지 선택합니다.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {(
            [
              { key: 'both', label: '시작일 & 마감일만 수신 (추천)', desc: '청약 시작하는 날과 끝나는 마지막 날 아침에만 받습니다.' },
              { key: 'start', label: '청약 시작일 당일에만 수신', desc: '청약이 시작되는 첫날 아침에만 한 번 받습니다.' },
              { key: 'end', label: '청약 마감일 당일에만 수신', desc: '청약이 마감되는 둘째 날 아침에만 받습니다.' },
            ] as const
          ).map(opt => (
            <label
              key={opt.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                padding: '0.6rem',
                borderRadius: '0.5rem',
                background: settings.pushTiming === opt.key ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255, 255, 255, 0.01)',
                border: `1px solid ${settings.pushTiming === opt.key ? 'rgba(16, 185, 129, 0.2)' : 'var(--glass-border)'}`,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <input
                type="radio"
                name="pushTiming"
                value={opt.key}
                checked={settings.pushTiming === opt.key}
                onChange={() => {
                  const updated = { ...settings, pushTiming: opt.key };
                  saveSettings(updated);
                }}
                style={{ width: 'auto', marginTop: '0.2rem', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: '600', color: settings.pushTiming === opt.key ? '#34d399' : 'var(--text-main)' }}>
                  {opt.label}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{opt.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 3. Filtering Section */}
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

      {/* 4. Manual Actions */}
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

