import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { sanitizeErrorMessage } from '../utils/validation';

/**
 * AI Analyst endpoints (Gemini). Two paths are registered for backwards
 * compatibility with older dashboard builds.
 */
export const aiRouter = express.Router();

const handleAiAnalyze = async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY is not configured on server. Please set GEMINI_API_KEY in environment variables.',
      });
    }

    const { symbol, timeframe, currentPrice, zone, emaFast, emaSlow, candles, recentCandles } = req.body;
    const targetCandles = candles || recentCandles || [];
    const ai = new GoogleGenAI({ apiKey });

    const recentCandlesSummary = Array.isArray(targetCandles)
      ? targetCandles
          .slice(-10)
          .map(
            (c: any) =>
              `Time: ${new Date(c.time * 1000).toISOString().slice(0, 16)} | Close: ${c.close} | Zone: ${c.zone} | Color: ${c.colorNameTh || ''}`
          )
          .join('\n')
      : 'ไม่มีข้อมูลแท่งเทียนย้อนหลัง';

    const prompt = `คุณคือผู้เชี่ยวชาญด้าน Technical Analysis ตลาดหุ้นไทย (SET) และเป็นผู้เชี่ยวชาญระบบ CDC Action Zone V3 (สูตรลุงโฉลก - Chaloke.org)
วิเคราะห์หุ้น ${symbol} บนไทม์เฟรม ${timeframe}:
- ราคาปัจจุบัน: ฿${currentPrice} บาท
- สถานะ CDC Zone: ${zone}
- Fast EMA (12): ฿${emaFast} | Slow EMA (26): ฿${emaSlow}
ข้อมูลแท่งเทียน:
${recentCandlesSummary}

ตอบเป็นรูปแบบ JSON เท่านั้น:
{
  "summary": "สรุปการวิเคราะห์เชิงเทคนิคและแนวโน้มราคาหุ้น 2-3 ประโยค",
  "marketTrend": "BULLISH" หรือ "BEARISH" หรือ "SIDEWAYS",
  "keyLevels": { "support": [แนวรับ1, แนวรับ2], "resistance": [แนวต้าน1, แนวต้าน2] },
  "botRecommendation": "คำแนะนำสำหรับตั้งค่าและออกออเดอร์ด้วย Bot CDC Action Zone V3",
  "riskAssessment": "ประเมินความเสี่ยงและคำแนะนำการจัดสรรเงินทุน (Money Management)"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text || '';
    let parsedData;
    try {
      parsedData = JSON.parse(text);
    } catch {
      parsedData = {
        summary: text,
        marketTrend: 'SIDEWAYS',
        keyLevels: { support: [currentPrice * 0.95], resistance: [currentPrice * 1.05] },
        botRecommendation: 'ทำตามวินัยระบบ CDC Action Zone V3',
        riskAssessment: 'ตั้ง Stop loss ทุกครั้งเพื่อควบคุมความเสี่ยง',
      };
    }

    return res.json(parsedData);
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

aiRouter.post('/ai/analyze', handleAiAnalyze);
aiRouter.post('/ai-analyze', handleAiAnalyze);
