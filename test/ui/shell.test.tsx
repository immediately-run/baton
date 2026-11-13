// shell.test.tsx — the `ui` project's one render test (B-193): the shell mounts and holds the
// placeholder the owner accepted until B-206 lands — "Baton dashboard — sign in".
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/dashboard/app/App';

describe('the dashboard shell', () => {
  it('renders the sign-in placeholder', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Baton' })).toBeDefined();
    expect(screen.getByText('Baton dashboard — sign in')).toBeDefined();
  });
});
