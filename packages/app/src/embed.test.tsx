import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ReactDOMClient from 'react-dom/client';
import { mount } from './embed';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Hoist shared mocks so the vi.mock factory (which is hoisted before all
// other module-level code) can reference the same function instances that
// the tests assert on.
const { mockRoot, mockCreateRoot } = vi.hoisted(() => {
  const mockRoot = { render: vi.fn(), unmount: vi.fn() };
  const mockCreateRoot = vi.fn(() => mockRoot);
  return { mockRoot, mockCreateRoot };
});

vi.mock('react-dom/client', () => ({
  // embed.tsx uses `import ReactDOM from 'react-dom/client'` (default import)
  default: { createRoot: mockCreateRoot },
  // Tests access the named export via `import * as ReactDOMClient`
  createRoot: mockCreateRoot,
}));

vi.mock('./App', () => ({ default: () => null }));
vi.mock('./index.css', () => ({}));
vi.mock('./storage/appStorage', () => ({
  LocalAppStorage: vi.fn(function LocalAppStorage() {}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mount()', () => {
  let el: HTMLElement;
  // Both the named export and the default's createRoot point to mockCreateRoot.
  const createRoot = vi.mocked(ReactDOMClient.createRoot);

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore createRoot mock implementation after clearAllMocks resets it.
    mockCreateRoot.mockReturnValue(mockRoot);
    el = makeContainer();
  });

  afterEach(() => {
    el.remove();
  });

  test('creates a React root and renders the app', () => {
    mount(el);
    expect(createRoot).toHaveBeenCalledWith(el);
    expect(mockRoot.render).toHaveBeenCalled();
  });

  test('returns a handle whose unmount() calls root.unmount()', () => {
    const handle = mount(el);
    handle.unmount();
    expect(mockRoot.unmount).toHaveBeenCalled();
  });

  test('sets data-markdone-mounted attribute on the element', () => {
    mount(el);
    expect(el.dataset.markdoneMounted).toBe('true');
  });

  test('double-mount guard: second call on same element is a no-op', () => {
    mount(el);
    const callsAfterFirst = createRoot.mock.calls.length;
    mount(el); // should be ignored
    expect(createRoot.mock.calls.length).toBe(callsAfterFirst);
  });

  test('unmount() clears the markdoneMounted attribute', () => {
    const handle = mount(el);
    handle.unmount();
    expect(el.dataset.markdoneMounted).toBeUndefined();
  });

  test('applies dark class when theme is "dark"', () => {
    mount(el, { theme: 'dark' });
    expect(el.classList.contains('dark')).toBe(true);
  });

  test('removes dark class when theme is "light"', () => {
    el.classList.add('dark');
    mount(el, { theme: 'light' });
    expect(el.classList.contains('dark')).toBe(false);
  });

  test('auto theme: adds dark class when OS prefers dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    mount(el, { theme: 'auto' });
    expect(el.classList.contains('dark')).toBe(true);
  });

  test('auto theme: registers a change listener that is removed on unmount', () => {
    const removeEventListener = vi.fn();
    const addEventListener = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener,
        removeEventListener,
      }),
    });

    const handle = mount(el, { theme: 'auto' });
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    handle.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  test('non-auto themes do not register a media query change listener', () => {
    const addEventListener = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener,
        removeEventListener: vi.fn(),
      }),
    });
    mount(el, { theme: 'dark' });
    expect(addEventListener).not.toHaveBeenCalled();
  });
});
