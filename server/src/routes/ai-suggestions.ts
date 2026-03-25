import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db';

const router = Router();

function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

interface Suggestion {
  bank_tx_id: string;
  gl_tx_id: string;
  confidence: number;
  reasoning: string;
  bank_desc: string;
  gl_desc: string;
  bank_amount: number;
  gl_amount: number;
  bank_date: string;
  gl_date: string;
}

// POST /api/ai/suggest - Get AI-powered match suggestions for a bank transaction
router.post('/suggest', async (req: Request, res: Response) => {
  const { bank_tx_id } = req.body;

  const openai = getOpenAIClient();
  if (!openai) {
    return res.status(503).json({ error: 'OpenAI API key not configured' });
  }

  if (!bank_tx_id) {
    return res.status(400).json({ error: 'bank_tx_id is required' });
  }

  try {
    // Fetch the bank transaction
    const bankResult = await pool.query('SELECT * FROM bank_transactions WHERE id = $1', [bank_tx_id]);
    if (bankResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bank transaction not found' });
    }
    const bankTx = bankResult.rows[0];

    // Fetch unmatched GL transactions (limit to reasonable number for context)
    const glResult = await pool.query(`
      SELECT gl.* FROM gl_transactions gl
      WHERE gl.id NOT IN (
        SELECT gl_tx_id FROM matched_transactions
        WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
      )
      ORDER BY gl.date DESC
      LIMIT 100
    `);

    if (glResult.rows.length === 0) {
      return res.json({ suggestions: [], message: 'No unmatched GL transactions available' });
    }

    // Format data for AI analysis
    const bankInfo = `Bank Transaction:
- ID: ${bankTx.id}
- Date: ${bankTx.date}
- Description: ${bankTx.description}
- Amount: ${bankTx.amount} EUR
- Type: ${bankTx.type} (${bankTx.type === 'debit' ? 'money out' : 'money in'})
- Reference: ${bankTx.reference_number || 'N/A'}
- Transaction Type: ${bankTx.transaction_type || 'N/A'}
- Bank: ${bankTx.bank_name || 'BOC'}`;

    const glList = glResult.rows.map((gl: any, i: number) =>
      `[${i}] ID:${gl.id} | Date:${gl.date} | Desc:${gl.description} | Amount:${gl.amount} EUR | Type:${gl.type} | Source:${gl.source || 'N/A'} | Seq:${gl.sequence || 'N/A'}`
    ).join('\n');

    const prompt = `You are a bank reconciliation expert. Analyze this bank transaction and find the best matching GL (General Ledger) entries from the list below.

${bankInfo}

Available GL Transactions:
${glList}

RECONCILIATION RULES:
1. Bank debits (money out) typically match GL credits, and vice versa
2. Cheque numbers in bank descriptions (e.g., "Cheque 59272102") should match reference numbers in GL descriptions (e.g., "HOUSE & GARDEN - 59272102")
3. Amounts should be close or exact matches
4. Dates can differ by a few days (cheques take time to clear)
5. Look for partial description matches (company names, invoice numbers)
6. Bank card transactions (CardTxnAdmin) may match GL entries with the merchant name
7. Bank transfers match GL transfers with similar amounts
8. "Standing Order" entries match recurring GL payments to the same payee

Return your top 3-5 best suggestions as a JSON array. Each suggestion must have:
- gl_index: the [index] number from the GL list
- confidence: 0-100 score
- reasoning: brief explanation (1-2 sentences) of why this is a match

Return ONLY valid JSON array, no markdown, no extra text:
[{"gl_index": 0, "confidence": 85, "reasoning": "Same cheque number 59272102, amount matches exactly"}]

If no reasonable matches exist, return an empty array: []`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0]?.message?.content || '[]';

    // Parse AI response
    let aiSuggestions: any[];
    try {
      // Clean up response - remove markdown code fences if present
      const cleaned = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      aiSuggestions = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse AI response:', responseText);
      aiSuggestions = [];
    }

    // Map AI suggestions back to actual GL transactions
    const suggestions: Suggestion[] = [];
    for (const s of aiSuggestions) {
      const glIdx = s.gl_index;
      if (glIdx >= 0 && glIdx < glResult.rows.length) {
        const gl = glResult.rows[glIdx];
        suggestions.push({
          bank_tx_id: bankTx.id,
          gl_tx_id: gl.id,
          confidence: Math.min(100, Math.max(0, s.confidence)),
          reasoning: s.reasoning,
          bank_desc: bankTx.description,
          gl_desc: gl.description,
          bank_amount: parseFloat(bankTx.amount),
          gl_amount: parseFloat(gl.amount),
          bank_date: bankTx.date,
          gl_date: gl.date,
        });
      }
    }

    // Sort by confidence descending
    suggestions.sort((a, b) => b.confidence - a.confidence);

    res.json({
      suggestions: suggestions.slice(0, 5),
      model: 'gpt-4o-mini',
      tokens_used: completion.usage?.total_tokens || 0,
    });
  } catch (err: any) {
    console.error('AI suggestion error:', err);
    if (err?.status === 401) {
      return res.status(503).json({ error: 'Invalid OpenAI API key' });
    }
    res.status(500).json({ error: 'Failed to get AI suggestions' });
  }
});

// POST /api/ai/suggest-batch - Get suggestions for multiple unmatched bank transactions
router.post('/suggest-batch', async (req: Request, res: Response) => {
  const openai = getOpenAIClient();
  if (!openai) {
    return res.status(503).json({ error: 'OpenAI API key not configured' });
  }

  try {
    // Get all unmatched bank transactions
    const bankResult = await pool.query(`
      SELECT bt.* FROM bank_transactions bt
      WHERE bt.id NOT IN (
        SELECT bank_tx_id FROM matched_transactions
        WHERE bank_tx_id IS NOT NULL AND status IN ('matched', 'approved')
      )
      ORDER BY bt.date DESC
      LIMIT 20
    `);

    // Get all unmatched GL transactions
    const glResult = await pool.query(`
      SELECT gl.* FROM gl_transactions gl
      WHERE gl.id NOT IN (
        SELECT gl_tx_id FROM matched_transactions
        WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
      )
      ORDER BY gl.date DESC
      LIMIT 100
    `);

    if (bankResult.rows.length === 0 || glResult.rows.length === 0) {
      return res.json({ suggestions: [], message: 'No unmatched transactions to analyze' });
    }

    const bankList = bankResult.rows.map((bt: any, i: number) =>
      `[B${i}] ID:${bt.id} | Date:${bt.date} | Desc:${bt.description} | Amount:${bt.amount} EUR | Type:${bt.type} | Ref:${bt.reference_number || 'N/A'} | TxType:${bt.transaction_type || 'N/A'}`
    ).join('\n');

    const glList = glResult.rows.map((gl: any, i: number) =>
      `[G${i}] ID:${gl.id} | Date:${gl.date} | Desc:${gl.description} | Amount:${gl.amount} EUR | Type:${gl.type} | Source:${gl.source || 'N/A'}`
    ).join('\n');

    const prompt = `You are a bank reconciliation expert. Match these unmatched bank transactions with the best GL entries.

UNMATCHED BANK TRANSACTIONS:
${bankList}

UNMATCHED GL TRANSACTIONS:
${glList}

RECONCILIATION RULES:
1. Bank debits (money out) match GL credits, bank credits (money in) match GL debits
2. Cheque numbers in bank (e.g., "Cheque 59272102") match GL references (e.g., "COMPANY - 59272102")
3. Amounts should be close or exact
4. Dates can differ by a few days
5. Card transactions (CardTxnAdmin) match GL entries with merchant names
6. Each bank tx should match at most ONE GL tx, and vice versa

Return matches as JSON array. Each match:
- bank_index: the B-number
- gl_index: the G-number
- confidence: 0-100
- reasoning: brief explanation

Return ONLY valid JSON array:
[{"bank_index": 0, "gl_index": 2, "confidence": 90, "reasoning": "Same cheque number"}]

Only include matches with confidence >= 50. Return [] if none found.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const responseText = completion.choices[0]?.message?.content || '[]';

    let aiSuggestions: any[];
    try {
      const cleaned = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      aiSuggestions = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse batch AI response:', responseText);
      aiSuggestions = [];
    }

    const suggestions: Suggestion[] = [];
    for (const s of aiSuggestions) {
      const bankIdx = s.bank_index;
      const glIdx = s.gl_index;
      if (bankIdx >= 0 && bankIdx < bankResult.rows.length &&
          glIdx >= 0 && glIdx < glResult.rows.length) {
        const bt = bankResult.rows[bankIdx];
        const gl = glResult.rows[glIdx];
        suggestions.push({
          bank_tx_id: bt.id,
          gl_tx_id: gl.id,
          confidence: Math.min(100, Math.max(0, s.confidence)),
          reasoning: s.reasoning,
          bank_desc: bt.description,
          gl_desc: gl.description,
          bank_amount: parseFloat(bt.amount),
          gl_amount: parseFloat(gl.amount),
          bank_date: bt.date,
          gl_date: gl.date,
        });
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence);

    res.json({
      suggestions,
      model: 'gpt-4o-mini',
      tokens_used: completion.usage?.total_tokens || 0,
    });
  } catch (err: any) {
    console.error('AI batch suggestion error:', err);
    res.status(500).json({ error: 'Failed to get AI suggestions' });
  }
});

export default router;
