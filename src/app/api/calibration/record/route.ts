import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

// Valid actions and their point values
const ACTION_POINTS: Record<string, number> = {
  approved: 3,
  approved_with_edit: 2,
  rejected: 1,
  skipped: 0.5,
};

// Calculate mode based on score
function calculateMode(score: number): string {
  if (score < 25) return 'supervised';
  if (score < 50) return 'guided';
  if (score < 75) return 'assisted';
  return 'autonomous';
}

/**
 * POST /api/calibration/record - Record a calibration interaction
 *
 * Body: { evaluator, task_type, action, feedback_text? }
 * Actions: approved (+3), approved_with_edit (+2), rejected (+1), skipped (+0.5)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Rate limit
  const limitError = mutationLimiter(request);
  if (limitError) return NextResponse.json({ error: limitError }, { status: 429 });

  try {
    const body = await request.json();
    const { evaluator, task_type, action, feedback_text } = body;

    // Validate required fields
    if (!evaluator || typeof evaluator !== 'string') {
      return NextResponse.json({ error: 'evaluator is required' }, { status: 400 });
    }
    if (!task_type || typeof task_type !== 'string') {
      return NextResponse.json({ error: 'task_type is required' }, { status: 400 });
    }
    if (!action || typeof action !== 'string') {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    // Validate action
    const points = ACTION_POINTS[action];
    if (points === undefined) {
      return NextResponse.json(
        { error: `Invalid action. Valid actions: ${Object.keys(ACTION_POINTS).join(', ')}` },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;

    // Check if calibration record exists
    const existing = db.prepare(`
      SELECT id, score, total_interactions
      FROM calibration_scores
      WHERE evaluator = ? AND task_type = ? AND workspace_id = ?
    `).get(evaluator, task_type, workspaceId) as { id: number; score: number; total_interactions: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { error: `No calibration record found for evaluator=${evaluator}, task_type=${task_type}` },
        { status: 404 }
      );
    }

    // Calculate new score (capped at 100)
    const newScore = Math.min(100, existing.score + points);
    const newTotalInteractions = existing.total_interactions + 1;
    const newMode = calculateMode(newScore);

    // Update record
    db.prepare(`
      UPDATE calibration_scores
      SET
        score = ?,
        total_interactions = ?,
        last_interaction_at = unixepoch(),
        last_feedback_text = ?,
        updated_at = unixepoch()
      WHERE id = ?
    `).run(newScore, newTotalInteractions, feedback_text || null, existing.id);

    logger.info(
      {
        evaluator,
        task_type,
        action,
        points,
        oldScore: existing.score,
        newScore,
        newMode,
        workspaceId,
      },
      'Calibration interaction recorded'
    );

    return NextResponse.json({
      ok: true,
      score: newScore,
      mode: newMode,
      total_interactions: newTotalInteractions,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to record calibration interaction');
    return NextResponse.json(
      { error: 'Failed to record calibration interaction' },
      { status: 500 }
    );
  }
}
