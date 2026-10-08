import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { IonSpinner } from '@ionic/angular';
import { AdminService, Banner } from '../../../core/services/admin.service';
import { UiService } from '../../../core/services/ui.service';
import { ImageUpload, compressImage } from '../../../core/utils/image';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';

interface BannerForm {
  id: string | null;
  title: string;
  link_url: string;
  is_active: boolean;
  preview: string | null;
  upload: ImageUpload | null;
}

@Component({
  selector: 'app-admin-banners',
  standalone: true,
  imports: [IonSpinner, EmptyStateComponent],
  templateUrl: './banners.page.html',
  styleUrls: ['./banners.page.scss'],
})
export class AdminBannersPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);

  readonly banners = signal<Banner[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly form = signal<BannerForm | null>(null);
  readonly saving = signal(false);
  readonly fileError = signal<string | null>(null);

  readonly linkValid = computed(() => {
    const link = this.form()?.link_url.trim();
    if (!link) return true;
    try {
      return ['http:', 'https:'].includes(new URL(link).protocol);
    } catch {
      return false;
    }
  });
  readonly formValid = computed(() => {
    const f = this.form();
    return !!f && !!f.preview && this.linkValid();
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin.listBanners().subscribe({
      next: (rows) => {
        this.banners.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message || 'Could not load banners.');
        this.loading.set(false);
      },
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.form() && !this.saving()) this.form.set(null);
  }

  openNew(): void {
    this.fileError.set(null);
    this.form.set({ id: null, title: '', link_url: '', is_active: true, preview: null, upload: null });
  }

  openEdit(b: Banner): void {
    this.fileError.set(null);
    this.form.set({ id: b.id, title: b.title || '', link_url: b.link_url || '', is_active: b.is_active, preview: b.image_url, upload: null });
  }

  patchForm(patch: Partial<BannerForm>): void {
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.fileError.set(null);
    try {
      const upload = await compressImage(file, 1600);
      this.patchForm({ upload, preview: upload.dataUrl });
    } catch (err) {
      this.fileError.set(err instanceof Error ? err.message : 'Could not read that picture.');
    }
  }

  save(): void {
    const f = this.form();
    if (!f || !this.formValid() || this.saving()) return;
    const body = { title: f.title.trim(), link_url: f.link_url.trim(), is_active: f.is_active, ...(f.upload ? { image_upload: f.upload } : {}) };
    this.saving.set(true);
    const req = f.id ? this.admin.updateBanner(f.id, body) : this.admin.createBanner(body);
    req.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success(res.message || 'Saved.');
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.ui.error(err);
      },
    });
  }

  toggleActive(b: Banner): void {
    this.busyId.set(b.id);
    this.admin.updateBanner(b.id, { is_active: !b.is_active }).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.banners.update((list) => list.map((x) => (x.id === b.id ? { ...x, is_active: res.data?.is_active ?? !b.is_active } : x)));
        this.ui.success(!b.is_active ? 'Banner is now shown to customers.' : 'Banner is hidden from customers.');
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  /** Swap this banner with its neighbour and save the new order. */
  move(index: number, dir: -1 | 1): void {
    const before = this.banners();
    const other = index + dir;
    if (other < 0 || other >= before.length) return;
    const list = [...before];
    [list[index], list[other]] = [list[other], list[index]];
    const reordered = list.map((b, i) => ({ ...b, sort_order: i }));
    this.banners.set(reordered);
    const changed = reordered.filter((b) => b.sort_order !== before.find((x) => x.id === b.id)?.sort_order);
    let failed = false;
    changed.forEach((b) =>
      this.admin.updateBanner(b.id, { sort_order: b.sort_order }).subscribe({
        error: (err) => {
          if (failed) return;
          failed = true;
          this.ui.error(err);
          this.load();
        },
      })
    );
  }

  async remove(b: Banner): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Delete this banner?',
      message: 'It disappears from the customer app straight away.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(b.id);
    this.admin.deleteBanner(b.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.ui.success(res.message || 'Banner deleted.');
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }
}
