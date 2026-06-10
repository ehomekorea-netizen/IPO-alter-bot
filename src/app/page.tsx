'use client';

import React, { useState, useEffect } from 'react';
import Settings, { SettingsConfig } from '@/components/settings';

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
}

export default function Home() {
  const [ipos, setIpos] = useState<IpoItem[]>([]);
  const [filteredIpos, setFilteredIpos] = useState<IpoItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Navigation & Tab States
  const [activeTab, setActiveTab] = useState<'list' | 'settings' | 'info'>('list');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'closed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Detail Modal (Bottom Sheet) State
  const [selectedIpo, setSelectedIpo] = useState<IpoItem | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);

  // Banner Notification State (In-App Toast)
  const [toastMessage, setToastMessage] = useState<{ title: string; desc: string } | null>(null);
  const [showToast, setShowToast] = useState(false);

  // Notification Permissions State
  const [notificationPermission, setNotificationPermission] = useState<string>('default');

  const [settings, setSettings] = useState<SettingsConfig>({
    slackWebhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    excludeSpac: true,
    excludeReit: false,
  });

  // Fetch IPOs
  const fetchIpos = async (currentSettings: SettingsConfig = settings) => {
    setLoading(true);
    try {
      const response = await fetch('/api/ipos');
      const data = await response.json();
      if (data.success) {
        setIpos(data.data);
        triggerBannerAlert(data.data, currentSettings);
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

  // Trigger system notification & in-app banner for today's subscriptions
  const triggerBannerAlert = (items: IpoItem[], currentSettings: SettingsConfig = settings) => {
    const today = getSeoulToday();
    const activeToday = items.filter(item => {
      if (currentSettings.excludeSpac && item.isSpac) return false;
      if (currentSettings.excludeReit && item.isReit) return false;
      return item.startDate <= today && today <= item.endDate;
    });

    if (activeToday.length > 0) {
      const title = '📢 오늘 청약 진행 중!';
      const desc = `${activeToday[0].company}${activeToday.length > 1 ? ` 외 ${activeToday.length - 1}건` : ''}의 청약이 진행 중입니다.`;
      
      // 1. Show In-App Toast
      setToastMessage({ title, desc });
      setShowToast(true);

      // Hide toast automatically after 5 seconds
      setTimeout(() => {
        setShowToast(false);
      }, 5500);

      // 2. Show Native OS Browser Banner (if allowed)
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
          body: desc,
          icon: '/icon.png',
        });
      }
    }
  };

  // Request Notification permission
  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        new Notification('🔔 알림 활성화 완료', {
          body: '이제 공모주 소식이 있을 때 시스템 배너 알림을 받으실 수 있습니다!',
          icon: '/icon.png',
        });
      }
    }
  };

  useEffect(() => {
    // Load settings from local storage immediately on mount before fetching
    let currentSettings = {
      slackWebhookUrl: '',
      telegramBotToken: '',
      telegramChatId: '',
      excludeSpac: true,
      excludeReit: false,
    };
    const saved = localStorage.getItem('ipo_bot_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        currentSettings = { ...currentSettings, ...parsed };
        setSettings(currentSettings);
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }

    fetchIpos(currentSettings);

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  // Filter and Sort IPOs
  useEffect(() => {
    const today = getSeoulToday();
    let result = [...ipos];

    // 1. Exclude based on settings
    if (settings.excludeSpac) {
      result = result.filter(item => !item.isSpac);
    }
    if (settings.excludeReit) {
      result = result.filter(item => !item.isReit);
    }

    // 2. Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        item =>
          item.company.toLowerCase().includes(query) ||
          item.broker.toLowerCase().includes(query)
      );
    }

    // 3. Group and Sort
    const active = result.filter(item => item.startDate <= today && today <= item.endDate);
    const upcoming = result.filter(item => today < item.startDate);
    const closed = result.filter(item => item.endDate < today);

    // Sort active: closing soonest first
    active.sort((a, b) => a.endDate.localeCompare(b.endDate));
    // Sort upcoming: starting soonest first
    upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
    // Sort closed: recently closed first (newest date first)
    closed.sort((a, b) => b.endDate.localeCompare(a.endDate));

    // 4. Combine based on selected status filter tab
    let finalResult: IpoItem[] = [];
    if (statusFilter === 'all') {
      // In the "All" tab, show active first, then upcoming, and limit closed to 5 items to avoid long scrolling
      finalResult = [...active, ...upcoming, ...closed.slice(0, 5)];
    } else if (statusFilter === 'active') {
      finalResult = active;
    } else if (statusFilter === 'upcoming') {
      finalResult = upcoming;
    } else if (statusFilter === 'closed') {
      finalResult = closed; // Show all closed items in the dedicated closed tab
    }

    setFilteredIpos(finalResult);
  }, [ipos, searchQuery, statusFilter, settings]);

  const handleSettingsChange = (newSettings: SettingsConfig) => {
    setSettings(newSettings);
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

  const openDetails = (item: IpoItem) => {
    setSelectedIpo(item);
    setShowBottomSheet(true);
  };

  const closeDetails = () => {
    setShowBottomSheet(false);
  };

  return (
    <div className="app-shell">
      <h1 className="sr-only">IPO Schedule Bot - 실시간 공모주 청약 알림 서비스</h1>

      {/* Top App Bar */}
      <header className="top-app-bar" aria-label="상단 메뉴바">
        <h1>IPO Schedule Bot</h1>
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
            style={{ width: '20px', height: '20px', animation: loading ? 'spin 1s linear infinite' : 'none' }}
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
        </button>
      </header>

      {/* In-App Toast Banner */}
      <div className={`toast-banner ${showToast ? 'show' : ''}`} role="alert" aria-live="assertive">
        <span style={{ fontSize: '1.25rem' }}>🔔</span>
        <div className="toast-banner-content">
          <div className="toast-banner-title">{toastMessage?.title}</div>
          <div className="toast-banner-desc">{toastMessage?.desc}</div>
        </div>
        <button className="toast-banner-close" onClick={() => setShowToast(false)} aria-label="알림 닫기">×</button>
      </div>

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
            <Settings onSettingsChange={handleSettingsChange} />
          </div>
        )}

        {activeTab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Page Title */}
            <h2 className="page-title">
              <span>ℹ️</span> 애플리케이션 정보
            </h2>

            {/* Native Banner Alerts */}
            <div className="app-card" style={{ cursor: 'default' }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', fontWeight: '700', color: '#8b5cf6' }}>🔔 기기 배너 알림 설정</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: '1.4' }}>
                활성화 시, 이 웹앱을 열 때 오늘 청약이 시작되거나 진행 중인 공모주가 있으면 스마트폰 화면 상단에 시스템 배너 알림을 즉시 띄워줍니다.
              </p>
              {notificationPermission === 'granted' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.8rem', fontWeight: '600' }}>
                  <span>✓</span> 기기 배너 알림이 활성화되어 있습니다.
                </div>
              ) : (
                <button className="btn btn-primary" onClick={requestNotificationPermission}>
                  배너 알림 승인하기
                </button>
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
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', fontWeight: '700' }}>IPO Schedule Bot v2.0</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                본 앱은 38.co.kr의 공식 청약 데이터를 수집하여 공모주 재테크를 돕는 도우미 봇 서비스입니다.<br />
                서버 비용 부담 없이 완전한 오픈소스로 가동되며, 로컬 스토리지를 활용하여 안전하게 동작합니다.
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
      >
        <div className="bottom-sheet-drag" onClick={closeDetails} />
        {selectedIpo && (
          <div>
            <h2 id="sheet-title" style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {selectedIpo.company}
              {selectedIpo.isSpac && <span className="badge badge-accent">스팩</span>}
              {selectedIpo.isReit && <span className="badge badge-accent">리츠</span>}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1.25rem' }}>
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
                <span className="detail-val" style={{ color: '#a78bfa' }}>{selectedIpo.broker}</span>
              </div>
            </div>

            <button className="btn btn-secondary" onClick={closeDetails} style={{ width: '100%' }}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
