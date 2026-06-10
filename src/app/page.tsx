'use client';

import React, { useState, useEffect } from 'react';
import Settings, { SettingsConfig } from '@/components/settings';
import { auth, db, googleProvider, isFirebaseConfigured } from '@/lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface IpoItem {
  company: string;
  date: string;
  startDate: string;
  endDate: string;
  finalPrice: string;
  hopePrice: string;
  broker: string;
  isSpac: boolean;
  isReit: boolean;
  detailUrl?: string;
}

// Utility to convert VAPID Key
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.replace(/=/g, '').length % 4)) % 4);
  const base64 = (base64String.replace(/=/g, '') + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Home() {
  const [ipos, setIpos] = useState<IpoItem[]>([]);
  const [filteredIpos, setFilteredIpos] = useState<IpoItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Auth States
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  // Navigation & Tab States
  const [activeTab, setActiveTab] = useState<'list' | 'settings' | 'info'>('list');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'closed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Detail Sheet Modal State
  const [selectedIpo, setSelectedIpo] = useState<IpoItem | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [detailData, setDetailData] = useState<{
    details: Record<string, string>;
    news: Array<{ title: string; link: string; press: string; pubDate: string }>;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Notification Permissions State
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);

  const [settings, setSettings] = useState<SettingsConfig>({
    slackWebhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    excludeSpac: true,
    excludeReit: false,
    pushTiming: 'both',
  });


  // Fetch IPOs
  const fetchIpos = async (currentSettings: SettingsConfig = settings) => {
    setLoading(true);
    try {
      const response = await fetch('/api/ipos');
      const data = await response.json();
      if (data.success) {
        setIpos(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch IPOs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get Seoul date in YYYY-MM-DD
  const getSeoulToday = () => {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')!.value;
    const month = parts.find(p => p.type === 'month')!.value;
    const day = parts.find(p => p.type === 'day')!.value;
    return `${year}-${month}-${day}`;
  };

  // Service Worker and Web Push Subscription handler
  const registerPushSubscription = async (currentUser: User, force: boolean = false) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      console.warn('Web Push or Service Worker is not supported by this browser.');
      return;
    }

    try {
      // 1. Register service worker
      const registration = await navigator.serviceWorker.register('/sw.js');
      
      // Wait for service worker to be active
      await navigator.serviceWorker.ready;
      
      // 2. Query/request notification permission
      let permission = Notification.permission;
      setNotificationPermission(permission);
      
      if (permission === 'default') {
        permission = await Notification.requestPermission();
        setNotificationPermission(permission);
      }

      if (permission !== 'granted') {
        console.warn('Notification permission was denied.');
        return;
      }

      // 3. Register Push subscription
      let subscription = await registration.pushManager.getSubscription();
      
      if (force && subscription) {
        try {
          await subscription.unsubscribe();
          subscription = null;
          console.log('Unsubscribed old push subscription to force a fresh sync.');
        } catch (e) {
          console.warn('Failed to unsubscribe old subscription:', e);
        }
      }

      if (!subscription) {
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
          console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY environment variable is not defined.');
          return;
        }

        const cleanKey = vapidPublicKey.trim().replace(/['"]/g, '');
        const convertedVapidKey = urlBase64ToUint8Array(cleanKey);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey,
        });
      }

      // 4. Update Firestore with subscription object
      if (isFirebaseConfigured && db) {
        const userRef = doc(db, 'users', currentUser.uid);
        await setDoc(userRef, {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          subscription: subscription.toJSON(),
        }, { merge: true });
        console.log('Successfully synchronized Push Subscription to Firestore.');
        setIsSubscribed(true);
      }
    } catch (error) {
      console.error('Failed to subscribe/register Web Push:', error);
    }
  };

  // Listen to Auth State
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        // Logged in: register SW and sync push token
        registerPushSubscription(currentUser);

        // Load settings from Firestore
        if (db) {
          try {
            const userRef = doc(db, 'users', currentUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const userData = userSnap.data();
              setIsSubscribed(!!userData.subscription);
              if (userData.settings) {
                setSettings(userData.settings);
                fetchIpos(userData.settings);
                return;
              }
            }
          } catch (e) {
            console.error('Error loading Firestore settings on mount:', e);
          }
        }
      }
      fetchIpos();
    });

    return () => unsubscribe();
  }, []);

  // Request Notification permission manually
  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        let permission: NotificationPermission;
        const requestPromise = Notification.requestPermission();
        
        if (requestPromise && typeof requestPromise.then === 'function') {
          permission = await requestPromise;
        } else {
          permission = await new Promise<NotificationPermission>((resolve) => {
            Notification.requestPermission((p) => resolve(p));
          });
        }

        setNotificationPermission(permission);
        if (permission === 'granted' && user) {
          // Triggers SW registration and subscription sync (force fresh subscription)
          registerPushSubscription(user, true);
        }
      } catch (err) {
        console.error('Failed to request notification permission:', err);
      }
    }
  };

  const unsubscribeNotification = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        console.log('Successfully unsubscribed from Web Push.');
      }
      
      // Update Firestore to remove subscription
      if (user && isFirebaseConfigured && db) {
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, { subscription: null }, { merge: true });
        console.log('Successfully removed subscription from Firestore.');
      }
      setIsSubscribed(false);
    } catch (error) {
      console.error('Failed to unsubscribe Web Push:', error);
    }
  };

  const handleToggleSubscription = async (enable: boolean) => {
    if (enable) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        try {
          let permission: NotificationPermission;
          const requestPromise = Notification.requestPermission();
          
          if (requestPromise && typeof requestPromise.then === 'function') {
            permission = await requestPromise;
          } else {
            permission = await new Promise<NotificationPermission>((resolve) => {
              Notification.requestPermission((p) => resolve(p));
            });
          }

          setNotificationPermission(permission);
          if (permission === 'granted' && user) {
            await registerPushSubscription(user, true);
          } else if (permission !== 'granted') {
            alert('알림 권한을 승인해야 활성화할 수 있습니다.');
          }
        } catch (err) {
          console.error('Failed to request notification permission:', err);
        }
      }
    } else {
      await unsubscribeNotification();
    }
  };

  // Check actual active subscription in browser on mount/user change
  useEffect(() => {
    const checkActiveSubscription = async () => {
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          setIsSubscribed(!!sub);
        } catch (e) {
          console.warn('Failed to check push subscription status:', e);
        }
      }
    };
    checkActiveSubscription();
  }, [user]);

  // Fallback Settings loader for demo mode or default
  useEffect(() => {
    if (!user) {
      const saved = localStorage.getItem('ipo_bot_settings');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSettings(prev => ({ ...prev, ...parsed }));
          fetchIpos({ ...settings, ...parsed });
        } catch (e) {
          console.error(e);
        }
      } else {
        fetchIpos();
      }
    }
    
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, [user]);

  // Filter and Sort IPOs
  useEffect(() => {
    const today = getSeoulToday();
    let result = [...ipos];

    if (settings.excludeSpac) {
      result = result.filter(item => !item.isSpac);
    }
    if (settings.excludeReit) {
      result = result.filter(item => !item.isReit);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        item =>
          item.company.toLowerCase().includes(query) ||
          item.broker.toLowerCase().includes(query)
      );
    }

    const active = result.filter(item => item.startDate <= today && today <= item.endDate);
    const upcoming = result.filter(item => today < item.startDate);
    const closed = result.filter(item => item.endDate < today);

    active.sort((a, b) => a.endDate.localeCompare(b.endDate));
    upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
    closed.sort((a, b) => b.endDate.localeCompare(a.endDate));

    let finalResult: IpoItem[] = [];
    if (statusFilter === 'all') {
      finalResult = [...active, ...upcoming, ...closed.slice(0, 5)];
    } else if (statusFilter === 'active') {
      finalResult = active;
    } else if (statusFilter === 'upcoming') {
      finalResult = upcoming;
    } else if (statusFilter === 'closed') {
      finalResult = closed;
    }

    setFilteredIpos(finalResult);
  }, [ipos, searchQuery, statusFilter, settings]);

  const handleSettingsChange = (newSettings: SettingsConfig) => {
    setSettings(newSettings);
  };

  const handleLogin = async () => {
    if (!isFirebaseConfigured || !auth || !googleProvider) return;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error('Google Sign-In failed:', e);
    }
  };

  const handleLogout = async () => {
    if (!isFirebaseConfigured || !auth) return;
    try {
      await signOut(auth);
      setUser(null);
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  const getIpoStatus = (item: IpoItem) => {
    const today = getSeoulToday();
    if (item.startDate <= today && today <= item.endDate) {
      return { label: '청약중', class: 'badge-success' };
    } else if (today < item.startDate) {
      return { label: '청약예정', class: 'badge-warning' };
    } else {
      return { label: '마감됨', class: 'badge-muted' };
    }
  };

  const openDetails = async (item: IpoItem) => {
    setSelectedIpo(item);
    setShowBottomSheet(true);
    
    if (!item.detailUrl) return;
    
    setDetailLoading(true);
    setDetailData(null);
    try {
      const url = `/api/ipos/detail?url=${encodeURIComponent(item.detailUrl)}&company=${encodeURIComponent(item.company)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setDetailData({
          details: data.details,
          news: data.news,
        });
      }
    } catch (e) {
      console.error('Failed to fetch IPO detail', e);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetails = () => {
    setShowBottomSheet(false);
  };

  // Render Premium Login View when Firebase is Configured but user is not logged in
  if (authLoading) {
    return (
      <div className="login-screen" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-app)' }}>
        <div className="spinner" aria-label="인증 확인 중"></div>
      </div>
    );
  }

  if (isFirebaseConfigured && !user && !demoMode) {
    return (
      <div className="login-screen">
        <div className="login-glass-card">
          <div className="login-logo-container">
            <span className="login-logo-emoji">🔔</span>
          </div>
          <h2 className="login-title">IPO Schedule Bot</h2>
          <p className="login-subtitle">실시간 공모주 알림 SaaS 서비스</p>
          <p className="login-description">
            구글 로그인을 통해 기기 네이티브 웹 푸시(Web Push) 알림을 구독하세요. 앱을 켜두지 않아도 청약 시작과 일정 소식을 즉시 수신할 수 있습니다.
          </p>
          
          <button className="btn-google-login" onClick={handleLogin}>
            <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.62 2.84c.88-2.6 3.3-4.52 6.2-4.52z" fill="#EA4335"/>
            </svg>
            Google 계정으로 계속하기
          </button>
          
          <button className="btn-demo-bypass" onClick={() => setDemoMode(true)}>
            로그인 없이 둘러보기 (데모)
          </button>
        </div>
      </div>
    );
  }

  // Render Configuration Helper when Firebase setup is absent
  if (!isFirebaseConfigured && !demoMode) {
    return (
      <div className="login-screen">
        <div className="login-glass-card" style={{ maxWidth: '440px' }}>
          <div className="login-logo-container" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
            <span className="login-logo-emoji" style={{ filter: 'none' }}>⚙️</span>
          </div>
          <h2 className="login-title" style={{ fontSize: '1.25rem' }}>Firebase 설정이 필요합니다</h2>
          <p className="login-description" style={{ fontSize: '0.8rem', textAlign: 'left', lineHeight: '1.6' }}>
            구글 로그인 및 Firestore 저장 기능을 사용하려면 Firebase 프로젝트 설정이 필요합니다.
            <br /><br />
            1. <code>.env.local</code> 파일에 Firebase API Key 등의 변수 값을 채워주세요.
            <br />
            2. VAPID Key는 기본값으로 셋팅되어 있습니다.
          </p>
          
          <button className="btn-google-login" style={{ background: 'var(--primary-purple)' }} onClick={() => setDemoMode(true)}>
            데모/로컬 모드로 진입하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <h1 className="sr-only">IPO Schedule Bot - 실시간 공모주 청약 알림 서비스</h1>

      {/* Top App Bar */}
      <header className="top-app-bar" aria-label="상단 메뉴바">
        <h1>IPO Schedule Bot</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => fetchIpos()}
            disabled={loading}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            aria-label="데이터 새로고침"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: '18px', height: '18px', animation: loading ? 'spin 1s linear infinite' : 'none' }}
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content Viewports */}
      <main className="app-content">
        {activeTab === 'list' && (
          <div>
            {/* Page Title */}
            <h2 className="page-title">
              <span>🗓️</span> 청약 일정 목록
            </h2>

            {/* Filter tab bar */}
            <div className="tab-pills" role="tablist" aria-label="청약 상태별 필터">
              {(
                [
                  { key: 'all', label: '전체' },
                  { key: 'active', label: '청약중' },
                  { key: 'upcoming', label: '예정' },
                  { key: 'closed', label: '마감' },
                ] as const
              ).map(tab => (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={statusFilter === tab.key}
                  className={`tab-pill ${statusFilter === tab.key ? 'active' : ''}`}
                  onClick={() => setStatusFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Mobile Search input */}
            <div style={{ marginBottom: '1.25rem' }}>
              <input
                type="text"
                placeholder="종목명 또는 주간사 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ fontSize: '0.85rem' }}
                aria-label="종목 검색"
              />
            </div>

            {/* Items List */}
            <div>
              {loading ? (
                <div className="spinner" aria-label="데이터 로딩 중"></div>
              ) : filteredIpos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                  <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}>🔍</span>
                  <p style={{ fontSize: '0.85rem' }}>조건에 맞는 일정이 없습니다.</p>
                </div>
              ) : (
                filteredIpos.map((item, idx) => {
                  const status = getIpoStatus(item);
                  return (
                    <div key={idx} className="app-card" onClick={() => openDetails(item)} role="button" tabIndex={0} aria-label={`${item.company} 상세 보기`}>
                      <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: '700', fontSize: '1rem' }}>{item.company}</span>
                          {item.isSpac && <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>스팩</span>}
                          {item.isReit && <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>리츠</span>}
                        </div>
                        <span className={`badge ${status.class}`}>{status.label}</span>
                      </div>
                      <div className="flex-between" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <span>청약: {item.date}</span>
                        <span style={{ color: '#a78bfa', fontWeight: '500' }}>{item.broker.split(',')[0]}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            {/* Page Title */}
            <h2 className="page-title">
              <span>⚙️</span> 알림 및 필터 설정
            </h2>
            <Settings 
              onSettingsChange={handleSettingsChange} 
              uid={user?.uid} 
              notificationPermission={notificationPermission}
              requestNotificationPermission={requestNotificationPermission}
              isSubscribed={isSubscribed}
              onToggleSubscription={handleToggleSubscription}
            />
          </div>
        )}


        {activeTab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Page Title */}
            <h2 className="page-title">
              <span>ℹ️</span> 애플리케이션 정보
            </h2>

            {/* User Account Info */}
            <div className="app-card" style={{ cursor: 'default' }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: '700', color: '#c084fc' }}>👤 내 계정 정보</h3>
              {user ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                    <div><strong>이름:</strong> {user.displayName}</div>
                    <div style={{ marginTop: '0.25rem' }}><strong>이메일:</strong> {user.email}</div>
                  </div>
                  <button className="btn btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.4rem 0.8rem' }} onClick={handleLogout}>
                    로그아웃
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    데모 모드 상태입니다. 전체 기능을 사용하려면 구글 로그인이 필요합니다.
                  </p>
                  <button className="btn btn-primary" style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.4rem 0.8rem' }} onClick={() => setDemoMode(false)}>
                    로그인 페이지로 이동
                  </button>
                </div>
              )}
            </div>

            {/* PWA Guide */}
            <div className="app-card" style={{ cursor: 'default' }}>

              <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', fontWeight: '700', color: '#10b981' }}>📱 홈 화면에 앱 설치하기</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                <strong>iOS Safari</strong>:<br />
                하단 공유 버튼(📤) 클릭 후 <strong>'홈 화면에 추가'</strong>를 누르시면 네이티브 앱처럼 아이콘으로 설치하여 전체화면으로 이용하실 수 있습니다.
                <br /><br />
                <strong>Android Chrome</strong>:<br />
                우측 상단 메뉴(⋮) 클릭 후 <strong>'앱 설치'</strong> 또는 <strong>'홈 화면에 추가'</strong>를 선택해 주세요.
              </p>
            </div>

            {/* App Info */}
            <div className="app-card" style={{ cursor: 'default', textAlign: 'center', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', fontWeight: '700' }}>IPO Schedule Bot v3.0</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                본 앱은 38.co.kr의 공식 청약 데이터를 수집하여 공모주 재테크를 돕는 SaaS형 도우미 봇 서비스입니다.<br />
                Firebase Auth 및 Firestore를 통해 안전하고 단독적인 다중 알림 환경을 구축합니다.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar */}
      <nav className="bottom-nav" aria-label="하단 네비게이션 바">
        <button
          className={`bottom-nav-item ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
          aria-label="청약 일정 목록 보기"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          일정 목록
        </button>

        <button
          className={`bottom-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          aria-label="알림 수신 및 필터 설정"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          알림 설정
        </button>

        <button
          className={`bottom-nav-item ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
          aria-label="앱 정보 및 기기 배너 설정"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          앱 정보
        </button>
      </nav>

      {/* Bottom Sheet Details Modal */}
      <div
        className={`bottom-sheet-overlay ${showBottomSheet ? 'show' : ''}`}
        onClick={closeDetails}
        aria-hidden="true"
      />
      <div
        className={`bottom-sheet ${showBottomSheet ? 'show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}
      >
        <div className="bottom-sheet-drag" onClick={closeDetails} />
        {selectedIpo && (
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <h2 id="sheet-title" style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {selectedIpo.company}
              {selectedIpo.isSpac && <span className="badge badge-accent">스팩</span>}
              {selectedIpo.isReit && <span className="badge badge-accent">리츠</span>}
            </h2>

            {/* Scrollable details wrapper */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.25rem', marginBottom: '1rem' }} className="app-content-scroll">
              
              {/* 1. Subscription Details */}
              <h3 style={{ fontSize: '0.9rem', color: '#a78bfa', fontWeight: '700', marginBottom: '0.5rem' }}>📋 공모 및 청약 정보</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginBottom: '1rem' }}>
                <div className="detail-row">
                  <span className="detail-label">청약 일정</span>
                  <span className="detail-val" style={{ color: '#fbbf24' }}>{selectedIpo.date}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">희망 공모가액</span>
                  <span className="detail-val">{selectedIpo.hopePrice}원</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">확정 공모가격</span>
                  <span className="detail-val" style={{ color: '#34d399', fontWeight: '700' }}>
                    {selectedIpo.finalPrice !== '-' ? `${selectedIpo.finalPrice}원` : '미확정'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">주간 증권사</span>
                  <span className="detail-val" style={{ color: '#c084fc' }}>{selectedIpo.broker}</span>
                </div>
                {detailData?.details['총공모주식수'] && (
                  <div className="detail-row">
                    <span className="detail-label">총 공모주식수</span>
                    <span className="detail-val">{detailData.details['총공모주식수']}</span>
                  </div>
                )}
                {detailData?.details['기관경쟁률'] && (
                  <div className="detail-row">
                    <span className="detail-label">수요예측 기관경쟁률</span>
                    <span className="detail-val" style={{ color: '#f59e0b', fontWeight: '700' }}>{detailData.details['기관경쟁률']}</span>
                  </div>
                )}
                {detailData?.details['의무보유확약'] && (
                  <div className="detail-row">
                    <span className="detail-label">의무보유확약 비율</span>
                    <span className="detail-val" style={{ color: '#10b981', fontWeight: '700' }}>{detailData.details['의무보유확약']}</span>
                  </div>
                )}
                {detailData?.details['환불일'] && (
                  <div className="detail-row">
                    <span className="detail-label">환불일 / 납입일</span>
                    <span className="detail-val">{detailData.details['환불일']}</span>
                  </div>
                )}
                {detailData?.details['상장일'] && (
                  <div className="detail-row">
                    <span className="detail-label">상장 예정일</span>
                    <span className="detail-val" style={{ fontWeight: '700' }}>{detailData.details['상장일']}</span>
                  </div>
                )}
              </div>

              {/* 2. Company Analysis Profile */}
              {!selectedIpo.isSpac && !selectedIpo.isReit && (
                <>
                  <h3 style={{ fontSize: '0.9rem', color: '#3b82f6', fontWeight: '700', marginBottom: '0.5rem' }}>🏢 기업 개요 및 분석</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginBottom: '1.25rem' }}>
                    <div className="detail-row">
                      <span className="detail-label">시장 / 종목코드</span>
                      <span className="detail-val">{detailData?.details['시장구분'] || '-'} / {detailData?.details['종목코드'] || '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">기업 업종 (사업 모델)</span>
                      <span className="detail-val" style={{ color: '#38bdf8', fontWeight: '600' }}>{detailData?.details['업종'] || (detailLoading ? '로딩 중...' : '-')}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">대표자명</span>
                      <span className="detail-val">{detailData?.details['대표자'] || '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">직전년도 매출액</span>
                      <span className="detail-val">{detailData?.details['매출액'] || '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">직전년도 순이익</span>
                      <span className="detail-val">{detailData?.details['순이익'] || '-'}</span>
                    </div>
                  </div>
                </>
              )}

              {/* 3. Real-time News list */}
              <h3 style={{ fontSize: '0.9rem', color: '#10b981', fontWeight: '700', marginBottom: '0.5rem' }}>📰 실시간 관련 뉴스</h3>
              {detailLoading ? (
                <div className="spinner" style={{ margin: '1rem auto', width: '24px', height: '24px' }} aria-label="상세 분석 정보 가져오는 중"></div>
              ) : detailData?.news && detailData.news.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {detailData.news.map((n, idx) => (
                    <a
                      key={idx}
                      href={n.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="app-card"
                      style={{
                        display: 'block',
                        padding: '0.75rem',
                        margin: 0,
                        textDecoration: 'none',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#f3f4f6', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                        {n.title}
                      </div>
                      <div className="flex-between" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        <span>{n.press}</span>
                        <span>{n.pubDate.split(' ').slice(1, 4).join(' ')}</span>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>관련 뉴스가 없습니다.</p>
              )}
            </div>

            <button className="btn btn-secondary" onClick={closeDetails} style={{ width: '100%', flexShrink: 0 }}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

