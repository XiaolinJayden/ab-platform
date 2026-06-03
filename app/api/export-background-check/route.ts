import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function csvCell(val: string | null | undefined): string {
  const s = String(val ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

// Make pipe-separated checkbox answers readable: "A||B||C" → "A, B, C"
function formatAnswer(val: string): string {
  return val.includes('||') ? val.split('||').map(s => s.trim()).join(', ') : val
}

function checkMatch(response: string, expected: string, questionType: string): boolean | null {
  if (!expected || questionType === 'short_text') return null

  if (questionType === 'multiple_choice') {
    const correctSet = new Set(expected.split('||').map(s => s.trim()).filter(Boolean))
    return correctSet.has(response.trim())
  }

  if (questionType === 'checkbox') {
    const r = new Set(response.split('||').map(s => s.trim()).filter(Boolean))
    const e = new Set(expected.split('||').map(s => s.trim()).filter(Boolean))
    if (r.size !== e.size) return false
    for (const item of e) if (!r.has(item)) return false
    return true
  }

  return response.trim() === expected.trim()
}

// GET /api/export-background-check?studyId=xxx&format=csv|json
// Requires researcher auth via bearer token
export async function GET(req: NextRequest) {
  const studyId = req.nextUrl.searchParams.get('studyId')
  const format = req.nextUrl.searchParams.get('format') === 'json' ? 'json' : 'csv'

  if (!studyId) return NextResponse.json({ error: 'Missing studyId' }, { status: 400 })

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = authHeader.replace('Bearer ', '')
  const supabase = createServiceClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: study } = await supabase
    .from('studies').select('id, title').eq('id', studyId).single()

  const { data: membership } = await supabase
    .from('study_researchers').select('role')
    .eq('study_id', studyId).eq('researcher_id', user.id).single()

  if (!study || !membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: questions } = await supabase
    .from('background_check_questions')
    .select('id, question_text, question_type, correct_answer, order_index')
    .eq('study_id', studyId)
    .order('order_index')

  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: 'No background check questions found' }, { status: 404 })
  }

  const { data: participants } = await supabase
    .from('participants')
    .select('id, email, created_at')
    .eq('study_id', studyId)
    .order('created_at')

  if (!participants) return NextResponse.json({ error: 'No participants' }, { status: 404 })

  const { data: responses } = await supabase
    .from('background_check_responses')
    .select('participant_id, question_id, response_value')
    .in('participant_id', participants.map(p => p.id))

  const slug = study.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()

  // ── JSON export ──────────────────────────────────────────────
  // Structure: one object per participant, question text as key, student answer as value
  if (format === 'json') {
    const data = {
      study: study.title,
      exported_at: new Date().toISOString(),
      responses: participants.map(p => {
        const answers: Record<string, string> = {}
        const expected_answers: Record<string, string> = {}
        const correct: Record<string, boolean | null> = {}

        questions.forEach(q => {
          const r = responses?.find(r => r.participant_id === p.id && r.question_id === q.id)
          const raw = r?.response_value ?? ''
          answers[q.question_text] = formatAnswer(raw)
          if (q.correct_answer) {
            expected_answers[q.question_text] = formatAnswer(q.correct_answer)
            correct[q.question_text] = checkMatch(raw, q.correct_answer, q.question_type)
          }
        })

        return {
          email: p.email,
          enrolled_at: p.created_at,
          answers,
          ...(Object.keys(expected_answers).length > 0 && { expected_answers, correct })
        }
      })
    }

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${slug}_background_check.json"`
      }
    })
  }

  // ── CSV export ───────────────────────────────────────────────
  // Layout: email | enrolled_at | [Q1] | [Q2] | ... | [Q1] — Expected | [Q2] — Expected | [Q1] — Correct? | [Q2] — Correct?
  // Student answers are the primary columns; expected/correct appended at the end for reference.

  const answerHeaders = questions.map(q => csvCell(q.question_text))
  const expectedHeaders = questions
    .filter(q => q.correct_answer)
    .map(q => csvCell(`${q.question_text} — Expected Answer`))
  const correctHeaders = questions
    .filter(q => q.correct_answer)
    .map(q => csvCell(`${q.question_text} — Correct?`))

  const header = ['email', 'enrolled_at', ...answerHeaders, ...expectedHeaders, ...correctHeaders].join(',')

  const rows = participants.map(p => {
    const answerCells = questions.map(q => {
      const r = responses?.find(r => r.participant_id === p.id && r.question_id === q.id)
      return csvCell(formatAnswer(r?.response_value ?? ''))
    })

    const expectedCells = questions
      .filter(q => q.correct_answer)
      .map(q => csvCell(formatAnswer(q.correct_answer)))

    const correctCells = questions
      .filter(q => q.correct_answer)
      .map(q => {
        const r = responses?.find(r => r.participant_id === p.id && r.question_id === q.id)
        const matched = checkMatch(r?.response_value ?? '', q.correct_answer, q.question_type)
        return csvCell(matched === null ? 'N/A' : matched ? 'yes' : 'no')
      })

    return [csvCell(p.email), csvCell(p.created_at), ...answerCells, ...expectedCells, ...correctCells].join(',')
  })

  const csv = [header, ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${slug}_background_check.csv"`
    }
  })
}
