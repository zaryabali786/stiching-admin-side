import { Component, computed, input } from '@angular/core';
import { ApprovalStatus, approvalLook, approvalShort } from '../../core/utils/approval';

/** Customer-approval status of one article: <app-approval-chip [status]="card.approval_status" /> */
@Component({
  selector: 'app-approval-chip',
  standalone: true,
  template: `<span [class]="'badge dot ' + look().tone">{{ short() ? shortText() : look().label }}</span>`,
})
export class ApprovalChipComponent {
  readonly status = input<ApprovalStatus | null | undefined>('none');
  /** Compact wording for the production board. */
  readonly short = input(false);
  readonly look = computed(() => approvalLook(this.status()));
  readonly shortText = computed(() => approvalShort(this.status()) || this.look().label);
}
