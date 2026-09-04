import AppLayout from './components/layout/AppLayout.js';
import ErrorBoundary from './components/ui/ErrorBoundary.js';

export default function App() {
  return (
    <ErrorBoundary>
      <AppLayout />
    </ErrorBoundary>
  );
}
