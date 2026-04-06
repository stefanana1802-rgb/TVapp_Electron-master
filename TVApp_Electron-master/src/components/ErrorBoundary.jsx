import React from 'react';

/**
 * Catches React render/commit errors and shows a fallback instead of a white screen.
 * Logs the error so it can be found in DevTools / console.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[TV App] Error boundary caught:', error, errorInfo?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-900 text-gray-200 p-8">
          <h1 className="text-xl font-semibold mb-2">A apărut o eroare</h1>
          <p className="text-sm text-gray-400 mb-4 max-w-md text-center">
            Aplicația s-a oprit. Poți reîmprospăta fereastra sau reporni aplicația.
          </p>
          <p className="text-xs text-gray-500 font-mono break-all max-w-lg text-center">
            {this.state.error?.message || 'Unknown error'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
