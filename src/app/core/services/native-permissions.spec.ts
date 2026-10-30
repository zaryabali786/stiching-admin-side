import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ request }),
}));

import { installGalleryPermissionPrompt } from './native-permissions';

describe('gallery permission before the first pick', () => {
  beforeEach(() => {
    localStorage.clear();
    request.mockReset();
    request.mockResolvedValue({ gallery: 'granted' });
  });

  it('asks once, then opens the chooser, and leaves later picks alone', async () => {
    installGalleryPermissionPrompt();
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    let opened = 0;
    input.addEventListener('click', () => opened++);

    input.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(request).toHaveBeenCalledTimes(1);
    expect(opened).toBe(1); // only the re-opened click reaches the input

    input.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(request).toHaveBeenCalledTimes(1);
    expect(opened).toBe(2);
  });

  it('ignores clicks on anything that is not a file input', () => {
    installGalleryPermissionPrompt();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.click();
    expect(request).not.toHaveBeenCalled();
  });
});
