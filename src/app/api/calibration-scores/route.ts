import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';

/**
 * GET /api/calibration-scores - List calibration scores
 *
 * Query params (optional):
 *   evaluator  - filter by evaluator name
 *   task_type  - filter by task type
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const evaluator = searchParams.get('evaluator');
  const task_type = searchParams.get('task_type');

  const db = getDatabase();
  const workspaceId = auth.user.workspace_id ?? 1;

  const conditions: string[] = ['workspace_id = ?'];
  const params: (string | number)[] = [workspaceId];

  if (evaluator) {
    conditions.push('evaluator = ?');
    params.push(evaluator);
  }
  if (task_type) {
    conditions.push('task_type = ?');
    params.push(task_type);
  }

  const where = conditions.join(' AND ');

  const scores = db
    .prepare(
      `SELECT evaluator, task_type, score, total_interactions, last_interaction_at, last_feedback_text
       FROM calibration_scores
       WHERE ${where}
       ORDER BY evaluator, task_type`
    )
    .all(...params) as {
    evaluator: string;
    task_type: string;
    score: number;
    total_interactions: number;
    last_interaction_at: number | null;
    last_feedback_text: string | null;
  }[];

  return NextResponse.json({ scores });
}
