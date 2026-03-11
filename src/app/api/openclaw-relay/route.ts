import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

const OPENCLAW_HOOKS_URL = process.env.OPENCLAW_HOOKS_URL || 'http://100.107.221.102:18789/hooks/wake'
const OPENCLAW_HOOKS_TOKEN = process.env.OPENCLAW_HOOKS_TOKEN || ''

/**
 * POST /api/openclaw-relay
 *
 * Transforms MC webhook payloads (event/timestamp/data format) into
 * OpenClaw hooks/wake format (text/mode) and forwards them.
 *
 * Register this URL as the MC webhook target instead of pointing
 * directly at OpenClaw's /hooks/wake endpoint.
 *
 * MC sends:
 *   { event: "activity.task_status_changed", timestamp: 123, data: { taskId, title, newStatus, ... } }
 *
 * OpenClaw expects:
 *   { text: "...", mode: "now" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { event, data } = body as {
      event?: string
      data?: Record<string, any>
    }

    if (!event || !data) {
      return NextResponse.json({ error: 'Invalid payload: missing event or data' }, { status: 400 })
    }

    // Build human-readable text for OpenClaw system event
    let text = `[MC] ${event}`

    if (event === 'activity.task_status_changed') {
      const { taskId, title, oldStatus, newStatus, assignedTo } = data
      if (newStatus === 'review') {
        text = `🔍 EVALÚA Task #${taskId}: "${title}" (${assignedTo || '?'}) entregó. Lee el entregable en MC, compara con el brief, score 0-10. ≥8.5 → mueve a quality_review. <8.5 → feedback al agente (max 3 intentos). GET ${process.env.MC_BASE_URL || 'http://localhost:3005'}/api/tasks/${taskId}`
      } else if (newStatus === 'quality_review') {
        // Wake Claw independently for quality gate
        const clawMsg = `🔍 QUALITY REVIEW Task #${taskId}: "${title}" llegó a quality_review. Lee el entregable, da tu verdict independiente (PASS/FAIL + razón). Notifica a Fred cuando termines via POST /api/agents/main/wake`
        fetch('http://localhost:3005/api/agents/watcher/wake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.MC_API_KEY || '' },
          body: JSON.stringify({ reason: clawMsg }),
        }).catch(() => {}) // best-effort, don't block Fred's notification
        text = `MC Task #${taskId} → quality_review: "${title}"${assignedTo ? ` (${assignedTo})` : ''} — Claw notificada`
      } else {
        text = `MC Task #${taskId} → ${newStatus}: "${title}"${assignedTo ? ` (${assignedTo})` : ''}${oldStatus ? ` [era: ${oldStatus}]` : ''}`
      }
    } else if (event === 'agent.status_change') {
      text = `MC Agent ${data.name || data.agentId}: ${data.status}`
    } else if (data.title) {
      text = `[MC] ${event}: ${data.title}`
    }

    // Forward to OpenClaw /hooks/wake
    const res = await fetch(OPENCLAW_HOOKS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_HOOKS_TOKEN}`,
      },
      body: JSON.stringify({ text, mode: 'now' }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      logger.warn({ status: res.status, err, event }, 'openclaw-relay: OpenClaw rejected wake')
      return NextResponse.json({ error: 'OpenClaw rejected', status: res.status }, { status: 502 })
    }

    logger.info({ event, text }, 'openclaw-relay: wake delivered')
    return NextResponse.json({ ok: true, text })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/openclaw-relay error')
    return NextResponse.json({ error: 'Relay failed' }, { status: 500 })
  }
}
