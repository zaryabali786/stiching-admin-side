import { Component, computed, input } from '@angular/core';
import { humanize, statusTone } from '../pipes';

/** <app-status-badge [status]="o.status" [label]="o.status_label" /> */
@Component({
  selector: 'app-status-badge',
  standalone: true,
  template: `<span [class]="'badge dot ' + tone()">{{ label() || text() }}</span>`,
})
export class StatusBadgeComponent {
  readonly status = input<string | null | undefined>(null);
  readonly label = input<string | null | undefined>(null);
  readonly tone = computed(() => statusTone(this.status()));
  readonly text = computed(() => humanize(this.status()));
}
