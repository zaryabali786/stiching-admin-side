import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DeleteAccountDialogComponent } from '../../shared/components/delete-account-dialog.component';

/** Opened from the partner menu ("My account"): the delete popup, over an empty page. Cancel goes back to the person's home. */
@Component({
  selector: 'app-delete-account',
  standalone: true,
  imports: [DeleteAccountDialogComponent],
  template: `<app-delete-account-dialog (closed)="back()" />`,
})
export class DeleteAccountPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  back(): void {
    void this.router.navigateByUrl(this.auth.homeUrl());
  }
}
