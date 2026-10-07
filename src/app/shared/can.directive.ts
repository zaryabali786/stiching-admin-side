import { Directive, EmbeddedViewRef, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { AuthService } from '../core/services/auth.service';

/**
 * Show something only when the signed-in person holds a permission (admins hold all of them):
 *   <button *can="'production.update'">Move</button>
 * This only tidies the screen; the server re-checks every request.
 */
@Directive({ selector: '[can]', standalone: true })
export class CanDirective {
  private auth = inject(AuthService);
  private template = inject(TemplateRef<unknown>);
  private container = inject(ViewContainerRef);
  private view: EmbeddedViewRef<unknown> | null = null;

  readonly can = input.required<string>();

  constructor() {
    effect(() => {
      const allowed = this.auth.can(this.can());
      if (allowed && !this.view) this.view = this.container.createEmbeddedView(this.template);
      else if (!allowed && this.view) {
        this.container.clear();
        this.view = null;
      }
    });
  }
}
