/**
 * AI analyst domain types: shape of the Gemini `/api/ai/analyze` response.
 */

export interface AiAnalysisResponse {
  summary: string;
  marketTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  botRecommendation: string;
  riskAssessment: string;
}
