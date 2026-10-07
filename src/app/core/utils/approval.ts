/** Per-article (per production ticket) customer approval. See backend/API.md "Approval per article". */
export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'changes_requested';

export interface ApprovalLook {
  label: string;
  /** badge tone class: '' neutral, amber needs action, green done, red problem */
  tone: '' | 'amber' | 'green' | 'red';
}

const LOOK: Record<ApprovalStatus, ApprovalLook> = {
  none: { label: 'Not sent yet', tone: '' },
  pending: { label: 'Waiting for the customer', tone: 'amber' },
  approved: { label: 'Approved by the customer', tone: 'green' },
  changes_requested: { label: 'Changes requested', tone: 'red' },
};

export function approvalLook(status: ApprovalStatus | null | undefined): ApprovalLook {
  return LOOK[status || 'none'] ?? LOOK.none;
}

/** Short wording for the production board. */
export function approvalShort(status: ApprovalStatus | null | undefined): string {
  return status === 'pending' ? 'Waiting for customer' : status === 'changes_requested' ? 'Changes requested' : '';
}
