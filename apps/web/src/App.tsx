import Shell from './shell/Shell.js';
import ErrorBoundary from './components/ui/ErrorBoundary.js';

export default function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
