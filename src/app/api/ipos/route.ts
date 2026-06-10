import { NextResponse } from 'next/server';
import { scrapeIpo } from '@/lib/scraper';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const excludeSpac = searchParams.get('excludeSpac') === 'true';
    const excludeReit = searchParams.get('excludeReit') === 'true';

    const ipos = await scrapeIpo({ excludeSpac, excludeReit });
    return NextResponse.json({ success: true, data: ipos });
  } catch (error: any) {
    console.error('API /api/ipos failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch IPO data' },
      { status: 500 }
    );
  }
}
