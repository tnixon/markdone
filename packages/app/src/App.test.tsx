import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

test('renders app and shows main UI after loading', async () => {
  render(<App />);
  // Wait for loading to finish and the empty-state prompt to appear
  await waitFor(() => {
    expect(screen.getAllByText(/Select a project|Create a workspace/i).length).toBeGreaterThan(0);
  }, { timeout: 3000 });
});
