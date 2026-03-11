import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/calibration - List all calibration scores
 *
 * Returns calibration scores for all evaluator × task_type pairs.
 * Calculates mode based on score thresholds.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;

    const scores = db.prepare(`
      SELECT
        evaluator,
        task_type,
        score,
        total_interactions,
        last_interaction_at,
        last_feedback_text
      FROM calibration_scores
      WHERE workspace_id = ?
      ORDER BY evaluator, task_type
    `).all(workspaceId) as Array<{
      evaluator: string;
      task_type: string;
      score: number;
      total_interactions: number;
      last_interaction_at: number | null;
      last_feedback_text: string | null;
    }>;

    // Calculate mode for each score
    const scoresWithMode = scores.map(row => {
      let mode: string;
      if (row.score < 25) {
        mode = 'supervised';
      } else if (row.score < 50) {
        mode = 'guided';
      } else if (row.score < 75) {
        mode = 'assisted';
      } else {
        mode = 'autonomous';
      }

      return {
        evaluator: row.evaluator,
        task_type: row.task_type,
        score: row.score,
        total_interactions: row.total_interactions,
        mode,
        last_interaction_at: row.last_interaction_at,
        last_feedback_text: row.last_feedback_text,
      };
    });

    logger.info({ count: scoresWithMode.length, workspaceId }, 'Calibration scores retrieved');

    return NextResponse.json({ scores: scoresWithMode });
  } catch (error) {
    logger.error({ err: error }, 'Failed to retrieve calibration scores');
    return NextResponse.json(
      { error: 'Failed to retrieve calibration scores' },
      { status: 500 }
    );
  }
}
