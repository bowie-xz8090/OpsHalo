const { z } = require('zod')

const SESSION_STATUSES = [
  'intake', 'planning', 'policy_check', 'awaiting_approval',
  'executing', 'observing', 'reducing', 'evaluating',
  'awaiting_user', 'verifying', 'paused', 'complete',
  'inconclusive', 'blocked', 'failed', 'cancelled'
]
const TERMINAL_STATUSES = ['complete', 'inconclusive', 'blocked', 'failed', 'cancelled']
const GOAL_STATUSES = ['continue', 'verify', 'complete', 'need_user', 'blocked']
const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5']
const SENSITIVITY_LEVELS = ['S0', 'S1', 'S2', 'S3']
const COST_LEVELS = ['C0', 'C1', 'C2', 'C3']
const POLICY_OUTCOMES = ['allow', 'require_approval', 'deny']
const EXECUTION_STATUSES = ['success', 'partial', 'error', 'timeout', 'cancelled', 'unknown']
const APPROVAL_SCOPES = ['once', 'task_exact_match']
const ERROR_CATEGORIES = [
  'command_not_found', 'permission_denied', 'unsupported_option',
  'timeout', 'output_truncated', 'transport_error',
  'interactive_required', 'policy_denied', 'invalid_model_output',
  'rate_limited', 'context_exhausted', 'session_mismatch',
  'cancelled', 'internal_error'
]
const AGENT_EVENT_TYPES = [
  'session.created', 'session.accepted', 'session.state_changed', 'session.snapshot',
  'provider.session_started', 'provider.phase', 'assistant.delta', 'assistant.completed', 'usage.updated',
  'harness.progress', 'plan.updated', 'budget.updated', 'action.proposed', 'policy.evaluated',
  'approval.requested', 'approval.resolved', 'execution.started',
  'execution.progress', 'execution.output_progress', 'execution.finished', 'observation.ready', 'observation.updated',
  'knowledge.retrieved',
  'evidence.available', 'evidence.deleted', 'user_input.requested',
  'user_input.resolved', 'verification.started', 'verification.finished',
  'session.paused', 'session.resumed', 'session.completed',
  'session.failed', 'session.cancelled'
]

module.exports = {
  SESSION_STATUSES,
  TERMINAL_STATUSES,
  GOAL_STATUSES,
  RISK_LEVELS,
  SENSITIVITY_LEVELS,
  COST_LEVELS,
  POLICY_OUTCOMES,
  EXECUTION_STATUSES,
  APPROVAL_SCOPES,
  ERROR_CATEGORIES,
  AGENT_EVENT_TYPES,
  SessionStatusSchema: z.enum(SESSION_STATUSES),
  GoalStatusSchema: z.enum(GOAL_STATUSES),
  RiskLevelSchema: z.enum(RISK_LEVELS),
  SensitivitySchema: z.enum(SENSITIVITY_LEVELS),
  CostLevelSchema: z.enum(COST_LEVELS),
  PolicyOutcomeSchema: z.enum(POLICY_OUTCOMES),
  ExecutionStatusSchema: z.enum(EXECUTION_STATUSES),
  ApprovalScopeSchema: z.enum(APPROVAL_SCOPES),
  ErrorCategorySchema: z.enum(ERROR_CATEGORIES),
  AgentEventTypeSchema: z.enum(AGENT_EVENT_TYPES)
}
