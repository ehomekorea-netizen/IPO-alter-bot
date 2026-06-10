import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IPO Schedule Bot - 실시간 공모주 청약 일정 대시보드',
  description: '38.co.kr 데이터를 실시간 파싱하여 슬랙/텔레그램으로 전송해 주는 지속 가능한 공모주 청약 알림 대시보드입니다.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'IPO Bot',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="apple-touch-icon" href="/icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
