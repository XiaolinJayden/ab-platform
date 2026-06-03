'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { BackgroundCheckQuestion, QuestionType } from '@/lib/types'

async function downloadResponses(studyId: string, format: 'csv' | 'json', studyTitle: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`/api/export-background-check?studyId=${studyId}&format=${format}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!res.ok) return
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${studyTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_background_check.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple Choice',
  checkbox: 'Checkboxes',
  likert: 'Likert Scale',
  short_text: 'Short Answer'
}

type FormState = {
  question_text: string
  question_type: QuestionType
  choices: string          // one per line
  mc_correct: string[]     // texts of correct MC choices (can be multiple)
  cb_correct: string[]     // texts of correct checkbox choices
  likert_scale: 5 | 7
  likert_low: string
  likert_high: string
  likert_correct: string   // number as string
}

const defaultForm = (): FormState => ({
  question_text: '',
  question_type: 'multiple_choice',
  choices: '',
  mc_correct: [],
  cb_correct: [],
  likert_scale: 5,
  likert_low: 'Strongly Disagree',
  likert_high: 'Strongly Agree',
  likert_correct: ''
})

function buildPayload(form: FormState, studyId: string, orderIndex: number) {
  let options_json: object | null = null
  let correct_answer = ''

  if (form.question_type === 'multiple_choice' || form.question_type === 'checkbox') {
    const choices = form.choices.split('\n').map(c => c.trim()).filter(Boolean)
    options_json = { choices }
    correct_answer = form.question_type === 'multiple_choice'
      ? form.mc_correct.join('||')
      : form.cb_correct.join('||')
  } else if (form.question_type === 'likert') {
    options_json = { scale: form.likert_scale, low_label: form.likert_low, high_label: form.likert_high }
    correct_answer = form.likert_correct
  }

  return {
    study_id: studyId,
    question_text: form.question_text.trim(),
    question_type: form.question_type,
    options_json,
    correct_answer,
    order_index: orderIndex
  }
}

export default function BackgroundCheckPage() {
  const { id: studyId } = useParams<{ id: string }>()
  const [questions, setQuestions] = useState<BackgroundCheckQuestion[]>([])
  const [studyTitle, setStudyTitle] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(defaultForm())
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState<'csv' | 'json' | null>(null)

  async function handleDownload(format: 'csv' | 'json') {
    setDownloading(format)
    await downloadResponses(studyId, format, studyTitle)
    setDownloading(null)
  }

  useEffect(() => { load() }, [studyId])

  async function load() {
    const { data: study } = await supabase.from('studies').select('title').eq('id', studyId).single()
    setStudyTitle(study?.title || '')
    const { data } = await supabase
      .from('background_check_questions')
      .select('*')
      .eq('study_id', studyId)
      .order('order_index')
    setQuestions(data || [])
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase
      .from('background_check_questions')
      .insert(buildPayload(form, studyId, questions.length))
    setSaving(false)
    setShowForm(false)
    setForm(defaultForm())
    load()
  }

  async function handleDelete(id: string) {
    await supabase.from('background_check_questions').delete().eq('id', id)
    load()
  }

  // Derived choices list from textarea
  const parsedChoices = form.choices.split('\n').map(c => c.trim()).filter(Boolean)

  function toggleMcCorrect(choice: string) {
    setForm(f => ({
      ...f,
      mc_correct: f.mc_correct.includes(choice)
        ? f.mc_correct.filter(c => c !== choice)
        : [...f.mc_correct, choice]
    }))
  }

  function toggleCbCorrect(choice: string) {
    setForm(f => ({
      ...f,
      cb_correct: f.cb_correct.includes(choice)
        ? f.cb_correct.filter(c => c !== choice)
        : [...f.cb_correct, choice]
    }))
  }

  return (
    <div className="max-w-3xl pb-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link href="/dashboard" className="hover:text-blue-600">Studies</Link>
        <span>/</span>
        <span className="text-slate-600 font-medium">{studyTitle}</span>
        <span>/</span>
        <span className="text-slate-600">Background Check</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Background Check</h1>
          <p className="text-sm text-slate-500 mt-1">
            Students must answer these questions correctly to enroll. Wrong answers disqualify them from this study — they can still browse other courses.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {questions.length > 0 && (
            <>
              <button
                onClick={() => handleDownload('csv')}
                disabled={downloading !== null}
                className="text-sm border border-slate-200 text-slate-600 hover:border-slate-400 hover:bg-slate-50 rounded-lg px-3 py-2 transition-colors disabled:opacity-50">
                {downloading === 'csv' ? 'Downloading…' : '↓ CSV'}
              </button>
              <button
                onClick={() => handleDownload('json')}
                disabled={downloading !== null}
                className="text-sm border border-slate-200 text-slate-600 hover:border-slate-400 hover:bg-slate-50 rounded-lg px-3 py-2 transition-colors disabled:opacity-50">
                {downloading === 'json' ? 'Downloading…' : '↓ JSON'}
              </button>
            </>
          )}
          <button onClick={() => setShowForm(true)}
            className="bg-amber-500 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-amber-600 transition-colors">
            + Add Question
          </button>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          <p className="text-2xl mb-2">🔍</p>
          <p className="text-sm">No background check questions yet. Add the first one!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q, i) => {
            const opts = q.options_json as any
            return (
              <div key={q.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-bold text-slate-400">Q{i + 1}</span>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        {QUESTION_TYPE_LABELS[q.question_type]}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-800">{q.question_text}</p>

                    {/* Options preview */}
                    {opts?.choices && (
                      <p className="text-xs text-slate-400 mt-1">{opts.choices.join(' · ')}</p>
                    )}
                    {opts?.scale && (
                      <p className="text-xs text-slate-400 mt-1">
                        Scale 1–{opts.scale}: {opts.low_label} → {opts.high_label}
                      </p>
                    )}

                    {/* Expected answer */}
                    {q.correct_answer ? (
                      <p className="text-xs text-amber-600 mt-1.5 font-medium">
                        Expected: {q.correct_answer.replace(/\|\|/g, ', ')}
                      </p>
                    ) : q.question_type === 'short_text' ? (
                      <p className="text-xs text-slate-400 mt-1.5">(short answer — informational only)</p>
                    ) : null}
                  </div>
                  <button onClick={() => handleDelete(q.id)}
                    className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add question modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-7 my-4">
            <h2 className="text-lg font-bold text-slate-900 mb-5">Add Background Check Question</h2>
            <form onSubmit={handleAdd} className="space-y-4">

              {/* Question text */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Question *</label>
                <textarea
                  required
                  rows={2}
                  value={form.question_text}
                  onChange={e => setForm(f => ({ ...f, question_text: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                  placeholder="e.g. What is the main topic of this course?"
                />
              </div>

              {/* Question type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Question Type</label>
                <select
                  value={form.question_type}
                  onChange={e => setForm(f => ({ ...f, question_type: e.target.value as QuestionType, mc_correct: [], cb_correct: [], likert_correct: '' }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                >
                  {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map(t => (
                    <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              {/* Multiple Choice */}
              {form.question_type === 'multiple_choice' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Options (one per line)</label>
                    <textarea
                      rows={4}
                      value={form.choices}
                      onChange={e => setForm(f => ({ ...f, choices: e.target.value, mc_correct: [] }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                      placeholder={"Option A\nOption B\nOption C"}
                    />
                  </div>
                  {parsedChoices.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Correct Answer(s) <span className="font-normal text-slate-400">(check all that are correct)</span>
                      </label>
                      <div className="space-y-1.5">
                        {parsedChoices.map(c => (
                          <label key={c} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={form.mc_correct.includes(c)}
                              onChange={() => toggleMcCorrect(c)}
                              className="accent-amber-600"
                            />
                            <span className="text-sm text-slate-700">{c}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Checkboxes */}
              {form.question_type === 'checkbox' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Options (one per line)</label>
                    <textarea
                      rows={4}
                      value={form.choices}
                      onChange={e => setForm(f => ({ ...f, choices: e.target.value, cb_correct: [] }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                      placeholder={"Option A\nOption B\nOption C"}
                    />
                  </div>
                  {parsedChoices.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Expected Answers <span className="font-normal text-slate-400">(check all that apply)</span>
                      </label>
                      <div className="space-y-1.5">
                        {parsedChoices.map(c => (
                          <label key={c} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={form.cb_correct.includes(c)}
                              onChange={() => toggleCbCorrect(c)}
                              className="accent-amber-600"
                            />
                            <span className="text-sm text-slate-700">{c}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Likert */}
              {form.question_type === 'likert' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Scale</label>
                      <select
                        value={form.likert_scale}
                        onChange={e => setForm(f => ({ ...f, likert_scale: Number(e.target.value) as 5 | 7, likert_correct: '' }))}
                        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                      >
                        <option value={5}>1 – 5</option>
                        <option value={7}>1 – 7</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Low label</label>
                      <input value={form.likert_low} onChange={e => setForm(f => ({ ...f, likert_low: e.target.value }))}
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Strongly Disagree" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">High label</label>
                      <input value={form.likert_high} onChange={e => setForm(f => ({ ...f, likert_high: e.target.value }))}
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Strongly Agree" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Expected Value <span className="font-normal text-slate-400">(for analysis, optional)</span>
                    </label>
                    <div className="flex gap-2">
                      {Array.from({ length: form.likert_scale }, (_, i) => i + 1).map(n => (
                        <button key={n} type="button"
                          onClick={() => setForm(f => ({ ...f, likert_correct: String(n) }))}
                          className={`w-9 h-9 rounded-lg border-2 text-sm font-medium transition-colors
                            ${form.likert_correct === String(n)
                              ? 'bg-amber-500 border-amber-500 text-white'
                              : 'border-slate-300 text-slate-600 hover:border-amber-400'}`}>
                          {n}
                        </button>
                      ))}
                      {form.likert_correct && (
                        <button type="button" onClick={() => setForm(f => ({ ...f, likert_correct: '' }))}
                          className="text-xs text-slate-400 hover:text-slate-600 ml-1">Clear</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Short Answer note */}
              {form.question_type === 'short_text' && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-slate-500">
                    Short answer questions are informational — no expected answer is set. Students can always proceed.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setForm(defaultForm()) }}
                  className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Cancel</button>
                <button type="submit" disabled={saving}
                  className="bg-amber-500 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-amber-600 disabled:opacity-50">
                  {saving ? 'Adding…' : 'Add Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Link href="/dashboard"
        className="fixed bottom-6 left-60 inline-flex items-center gap-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded-lg px-4 py-2 shadow-sm transition-colors z-10">
        ← Back to Studies
      </Link>
    </div>
  )
}
